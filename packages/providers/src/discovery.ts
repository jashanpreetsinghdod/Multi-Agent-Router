import type { Capabilities, ErrorClass, Provider } from '@omnirouter/canonical';
import type { ModelInfo } from './types.js';
import { MODEL_CATALOG } from './catalog.js';
import { safeMessage } from './types.js';

export interface DiscoveredModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoning?: boolean;
}

export type DiscoveryResult =
  | { ok: true; models: DiscoveredModel[] }
  | { ok: false; errorClass: ErrorClass; detail: string; httpStatus?: number };

export interface DiscoveryConfig {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com/v1';
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_PAGES = 10;

const NON_CHAT = /(embed|whisper|tts|dall-e|davinci|babbage|moderation|image|audio|realtime|transcribe|sora|search-preview|computer-use|rerank|imagen|veo|aqa)/i;

export async function discoverModels(
  provider: Provider,
  config: DiscoveryConfig,
): Promise<DiscoveryResult> {
  try {
    switch (provider) {
      case 'anthropic':
        return await discoverAnthropic(config);
      case 'openai':
        return await discoverOpenAiStyle(config, config.baseUrl ?? OPENAI_BASE);
      case 'compatible':
        if (!config.baseUrl) {
          return { ok: false, errorClass: 'invalid_request', detail: 'A base URL is required for OpenAI-compatible endpoints.' };
        }
        return await discoverOpenAiStyle(config, config.baseUrl);
      case 'google':
        return await discoverGoogle(config);
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      return { ok: false, errorClass: 'timeout', detail: 'model discovery timed out' };
    }
    return { ok: false, errorClass: 'unknown', detail: safeMessage(error, 'model discovery failed') };
  }
}

async function discoverAnthropic(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const base = (config.baseUrl ?? ANTHROPIC_BASE).replace(/\/+$/, '');
  const models: DiscoveredModel[] = [];
  let afterId: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/v1/models`);
    url.searchParams.set('limit', '1000');
    if (afterId) url.searchParams.set('after_id', afterId);

    const res = await fetch(url, {
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      signal: config.signal,
    });
    if (!res.ok) return httpFailure(res);

    const body = (await res.json()) as {
      data?: Array<{ id: string; display_name?: string; max_input_tokens?: number; max_tokens?: number }>;
      has_more?: boolean;
      last_id?: string;
    };
    for (const m of body.data ?? []) {
      models.push({
        id: m.id,
        ...(m.display_name ? { displayName: m.display_name } : {}),
        ...(m.max_input_tokens ? { contextWindow: m.max_input_tokens } : {}),
        ...(m.max_tokens ? { maxOutputTokens: m.max_tokens } : {}),
      });
    }
    if (!body.has_more || !body.last_id) break;
    afterId = body.last_id;
  }
  return { ok: true, models };
}

async function discoverOpenAiStyle(config: DiscoveryConfig, baseUrl: string): Promise<DiscoveryResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    signal: config.signal,
  });
  if (!res.ok) return httpFailure(res);

  const body = (await res.json()) as {
    data?: Array<{ id: string; context_length?: number; context_window?: number; name?: string }>;
  };
  const models = (body.data ?? [])
    .filter((m) => typeof m.id === 'string' && !NON_CHAT.test(m.id))
    .map((m): DiscoveredModel => {
      const ctx = m.context_length ?? m.context_window;
      return {
        id: m.id,
        ...(m.name ? { displayName: m.name } : {}),
        ...(ctx ? { contextWindow: ctx } : {}),
      };
    });
  return { ok: true, models };
}

async function discoverGoogle(config: DiscoveryConfig): Promise<DiscoveryResult> {
  const base = (config.baseUrl ?? GOOGLE_BASE).replace(/\/+$/, '');
  const models: DiscoveredModel[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/models`);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    // Key goes in a header, never the query string, so it stays out of logs.
    const res = await fetch(url, {
      headers: { 'x-goog-api-key': config.apiKey },
      signal: config.signal,
    });
    if (!res.ok) return httpFailure(res);

    const body = (await res.json()) as {
      models?: Array<{
        name: string;
        displayName?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
        thinking?: boolean;
      }>;
      nextPageToken?: string;
    };
    for (const m of body.models ?? []) {
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
      const id = m.name.replace(/^models\//, '');
      if (NON_CHAT.test(id)) continue;
      models.push({
        id,
        ...(m.displayName ? { displayName: m.displayName } : {}),
        ...(m.inputTokenLimit ? { contextWindow: m.inputTokenLimit } : {}),
        ...(m.outputTokenLimit ? { maxOutputTokens: m.outputTokenLimit } : {}),
        ...(m.thinking !== undefined ? { reasoning: m.thinking } : {}),
      });
    }
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return { ok: true, models };
}

async function httpFailure(res: Response): Promise<DiscoveryResult> {
  const text = (await res.text().catch(() => '')).slice(0, 300);
  const errorClass: ErrorClass =
    res.status === 401 || res.status === 403
      ? 'auth'
      : res.status === 429
        ? 'rate_limit'
        : res.status === 404
          ? 'invalid_request'
          : res.status >= 500
            ? 'overloaded'
            : 'unknown';
  const detail =
    errorClass === 'auth'
      ? 'The provider rejected this API key.'
      : errorClass === 'invalid_request'
        ? 'The models endpoint was not found. Check the base URL.'
        : `Provider returned HTTP ${res.status}${text ? `: ${text}` : ''}`;
  return { ok: false, errorClass, detail, httpStatus: res.status };
}

// ── Merging discovered models with the catalog ───────────────────────────────

const NO_CAPS: Capabilities = {
  vision: false,
  pdf: false,
  tools: false,
  structuredOutput: false,
  promptCaching: false,
  reasoning: false,
  streaming: true,
};

export function toModelInfo(provider: Provider, discovered: DiscoveredModel): ModelInfo {
  const known = MODEL_CATALOG.find((m) => m.provider === provider && m.modelId === discovered.id);
  if (known) return { ...known };

  return {
    provider,
    modelId: discovered.id,
    routerId: `${provider}/${discovered.id}`,
    displayName: discovered.displayName ?? discovered.id,
    contextWindow: discovered.contextWindow ?? defaultContext(provider),
    maxOutputTokens: discovered.maxOutputTokens ?? 8192,
    capabilities: inferCapabilities(provider, discovered),
    pricing: null,
    status: 'available',
  };
}

export function isCatalogModel(provider: Provider, modelId: string): boolean {
  return MODEL_CATALOG.some((m) => m.provider === provider && m.modelId === modelId);
}

function defaultContext(provider: Provider): number {
  switch (provider) {
    case 'anthropic':
      return 200_000;
    case 'google':
      return 1_000_000;
    default:
      return 128_000;
  }
}

function inferCapabilities(provider: Provider, m: DiscoveredModel): Capabilities {
  const id = m.id.toLowerCase();
  switch (provider) {
    case 'anthropic':
      return { ...NO_CAPS, vision: true, pdf: true, tools: true, promptCaching: true };
    case 'openai':
      return {
        ...NO_CAPS,
        vision: !/^gpt-3\.5/.test(id),
        tools: !/^gpt-3\.5-turbo-instruct/.test(id),
        structuredOutput: true,
        reasoning: /^(o\d|gpt-5)/.test(id),
      };
    case 'google':
      return {
        ...NO_CAPS,
        vision: true,
        pdf: true,
        tools: !/gemma/.test(id),
        structuredOutput: true,
        reasoning: m.reasoning ?? false,
      };
    // Unknown third-party endpoints: claim nothing we cannot verify.
    case 'compatible':
      return { ...NO_CAPS };
  }
}
