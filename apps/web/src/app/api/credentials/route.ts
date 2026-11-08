import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ProviderSchema, type Provider } from '@omnirouter/canonical';
import { discoverModels, toModelInfo, type ModelInfo } from '@omnirouter/providers';
import { assertPublicUrl } from '@omnirouter/tools';
import {
  MAX_CREDENTIALS_PER_OWNER,
  capModels,
  defaultEnabledModels,
  fingerprintOf,
  toPublic,
  validEnabled,
  withManualModel,
  withRediscovered,
} from '@/lib/credentials';
import { getStore, ownerFrom } from '@/lib/store';
import { noSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DISCOVERY_TIMEOUT_MS = 15_000;
const modelIdSchema = z.string().trim().min(1).max(128).regex(/^[\w.\-:/@]+$/, 'invalid model id');

const AddSchema = z.object({
  provider: ProviderSchema,
  apiKey: z.string().trim().min(8).max(500),
  label: z.string().trim().max(60).optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  manualModels: z.array(modelIdSchema).max(20).optional(),
});

const PatchSchema = z.object({
  id: z.string().uuid(),
  enabledModelIds: z.array(modelIdSchema).max(500).optional(),
  addModelId: modelIdSchema.optional(),
  refresh: z.boolean().optional(),
});

const sortModels = (models: ModelInfo[]) => models.sort((a, b) => a.displayName.localeCompare(b.displayName));

export async function GET(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const creds = await getStore().listCredentials(owner);
  return NextResponse.json(creds.map(toPublic));
}

export async function POST(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const store = getStore();

  const parsed = AddSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }
  const { provider, apiKey, label, manualModels = [] } = parsed.data;

  if ((await store.listCredentials(owner)).length >= MAX_CREDENTIALS_PER_OWNER) {
    return NextResponse.json({ error: 'Too many keys. Remove one first.' }, { status: 400 });
  }
  if (await store.hasFingerprint(owner, fingerprintOf(apiKey))) {
    return NextResponse.json({ error: 'This key is already added.' }, { status: 409 });
  }

  const baseUrl = await checkBaseUrl(provider, parsed.data.baseUrl);
  if ('error' in baseUrl) return NextResponse.json({ error: baseUrl.error }, { status: 400 });

  // Discovery doubles as validation: listing models is free and needs a valid key.
  const discovery = await discoverModels(provider, {
    apiKey,
    ...(baseUrl.value ? { baseUrl: baseUrl.value } : {}),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  let models: ModelInfo[];
  let discoveryNote: string | undefined;

  if (discovery.ok) {
    models = sortModels(discovery.models.map((m) => toModelInfo(provider, m)));
  } else if (provider === 'compatible' && discovery.errorClass !== 'auth' && manualModels.length > 0) {
    models = [];
    discoveryNote = 'This endpoint does not list its models, so the key could not be verified in advance.';
  } else {
    const hint =
      provider === 'compatible' && discovery.errorClass !== 'auth'
        ? ' If this endpoint cannot list models, enter a model id manually.'
        : '';
    return NextResponse.json({ error: `${discovery.detail}${hint}` }, { status: 400 });
  }

  for (const id of manualModels) {
    if (!models.some((m) => m.modelId === id)) models.push(toModelInfo(provider, { id }));
  }
  models = capModels(models);

  const cred = await store.addCredential(owner, {
    provider,
    apiKey,
    label: label || `${provider} key …${apiKey.slice(-4)}`,
    ...(baseUrl.value ? { baseUrl: baseUrl.value } : {}),
    models,
    enabledModelIds: validEnabled({ models }, [...defaultEnabledModels(provider, models), ...manualModels]),
    ...(discoveryNote ? { discoveryNote } : {}),
  });
  await store.audit(owner, 'credential.created', { id: cred.id, provider, models: models.length });

  return NextResponse.json(toPublic(cred), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const store = getStore();

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }
  let cred = await store.getCredential(owner, parsed.data.id);
  if (!cred) return NextResponse.json({ error: 'Credential not found' }, { status: 404 });

  if (parsed.data.refresh) {
    const apiKey = await store.credentialSecret(owner, cred.id);
    if (!apiKey) return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    const discovery = await discoverModels(cred.provider, {
      apiKey,
      ...(cred.baseUrl ? { baseUrl: cred.baseUrl } : {}),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!discovery.ok) return NextResponse.json({ error: discovery.detail }, { status: 400 });
    const next = withRediscovered(cred, sortModels(discovery.models.map((m) => toModelInfo(cred!.provider, m))));
    await store.updateCredential(owner, cred.id, { ...next, discoveryNote: null });
    cred = { ...cred, ...next };
    delete cred.discoveryNote;
  }
  if (parsed.data.enabledModelIds) {
    const enabledModelIds = validEnabled(cred, parsed.data.enabledModelIds);
    await store.updateCredential(owner, cred.id, { enabledModelIds });
    cred = { ...cred, enabledModelIds };
  }
  if (parsed.data.addModelId) {
    const next = withManualModel(cred, parsed.data.addModelId);
    await store.updateCredential(owner, cred.id, next);
    cred = { ...cred, ...next };
  }

  return NextResponse.json(toPublic(cred));
}

export async function DELETE(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const store = getStore();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (!(await store.removeCredential(owner, id))) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
  }
  await store.audit(owner, 'credential.deleted', { id });
  return NextResponse.json({ ok: true });
}

async function checkBaseUrl(
  provider: Provider,
  raw: string | undefined,
): Promise<{ value: string | undefined } | { error: string }> {
  if (provider !== 'compatible') {
    return raw ? { error: 'A base URL can only be set for OpenAI-compatible endpoints.' } : { value: undefined };
  }
  if (!raw) return { error: 'A base URL is required for OpenAI-compatible endpoints.' };

  const value = raw.replace(/\/+$/, '');
  if (process.env.ALLOW_PRIVATE_BASE_URLS === 'true') return { value };

  if (!value.startsWith('https://')) return { error: 'The base URL must use https.' };
  const check = await assertPublicUrl(value);
  if (!check.safe) return { error: `Base URL rejected: ${check.reason}` };
  return { value };
}
