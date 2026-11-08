import { createHash } from 'node:crypto';
import type { Provider } from '@omnirouter/canonical';
import type { ModelInfo } from '@omnirouter/providers';
import { isCatalogModel, toModelInfo } from '@omnirouter/providers';
import type { RouterModel } from '@omnirouter/router-core';
import { getStore, type CredentialRecord } from './store';

export const MAX_CREDENTIALS_PER_OWNER = 20;
const MAX_MODELS_PER_CREDENTIAL = 500;
const DEFAULT_ENABLE_LIMIT = 5;

export interface PublicCredential {
  id: string;
  provider: Provider;
  label: string;
  keyLast4: string;
  baseUrl?: string;
  createdAt: string;
  discoveryNote?: string;
  models: Array<{
    modelId: string;
    routerId: string;
    displayName: string;
    enabled: boolean;
    known: boolean;
    contextWindow: number;
    pricing: ModelInfo['pricing'];
  }>;
}

export function fingerprintOf(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function capModels(models: ModelInfo[]): ModelInfo[] {
  return models.slice(0, MAX_MODELS_PER_CREDENTIAL);
}

export function defaultEnabledModels(provider: Provider, models: ModelInfo[]): string[] {
  const known = models.filter((m) => isCatalogModel(provider, m.modelId)).map((m) => m.modelId);
  if (known.length > 0) return known;
  return models.slice(0, DEFAULT_ENABLE_LIMIT).map((m) => m.modelId);
}

export function validEnabled(cred: Pick<CredentialRecord, 'models'>, ids: string[]): string[] {
  const valid = new Set(cred.models.map((m) => m.modelId));
  return [...new Set(ids.filter((id) => valid.has(id)))];
}

export function withManualModel(
  cred: CredentialRecord,
  modelId: string,
): { models: ModelInfo[]; enabledModelIds: string[] } {
  const models = cred.models.some((m) => m.modelId === modelId)
    ? cred.models
    : capModels([...cred.models, toModelInfo(cred.provider, { id: modelId })]);
  const enabled = models.some((m) => m.modelId === modelId)
    ? [...new Set([...cred.enabledModelIds, modelId])]
    : cred.enabledModelIds;
  return { models, enabledModelIds: enabled };
}

export function withRediscovered(
  cred: CredentialRecord,
  discovered: ModelInfo[],
): { models: ModelInfo[]; enabledModelIds: string[] } {
  const ids = new Set(discovered.map((m) => m.modelId));
  const manual = cred.models.filter((m) => !ids.has(m.modelId) && cred.enabledModelIds.includes(m.modelId));
  const models = capModels([...discovered, ...manual]);
  return { models, enabledModelIds: validEnabled({ models }, cred.enabledModelIds) };
}

export function toPublic(cred: CredentialRecord): PublicCredential {
  const enabled = new Set(cred.enabledModelIds);
  return {
    id: cred.id,
    provider: cred.provider,
    label: cred.label,
    keyLast4: cred.keyLast4,
    ...(cred.baseUrl ? { baseUrl: cred.baseUrl } : {}),
    createdAt: cred.createdAt.toISOString(),
    ...(cred.discoveryNote ? { discoveryNote: cred.discoveryNote } : {}),
    models: cred.models.map((m) => ({
      modelId: m.modelId,
      routerId: m.routerId,
      displayName: m.displayName,
      enabled: enabled.has(m.modelId),
      known: isCatalogModel(cred.provider, m.modelId),
      contextWindow: m.contextWindow,
      pricing: m.pricing,
    })),
  };
}

export async function enabledRouterModels(owner: string): Promise<RouterModel[]> {
  const out: RouterModel[] = [];
  for (const cred of await getStore().listCredentials(owner)) {
    const enabled = new Set(cred.enabledModelIds);
    for (const m of cred.models) {
      if (enabled.has(m.modelId)) out.push({ ...m, enabledByUser: true, credentialId: cred.id });
    }
  }
  return out;
}
