import type {
  Block,
  Capabilities,
  ChatRequest,
  ErrorClass,
  Provider,
  StreamEvent,
} from '@omnirouter/canonical';

export interface ModelInfo {
  provider: Provider;
  /** Wire id sent to the provider, e.g. `claude-opus-5-5`. */
  modelId: string;
  /** Router-facing id, e.g. `anthropic/claude-opus-5-5`. Stable across aliasing. */
  routerId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Capabilities;
  /** USD per million tokens. Null means "unknown, do not route here for cost-sensitive requests". */
  pricing: {
    inputPerMTok: number;
    outputPerMTok: number;
    cacheReadPerMTok?: number;
    cacheWritePerMTok?: number;
  } | null;
  status: 'available' | 'deprecated' | 'unavailable';
}

export interface AdapterConfig {
  /** Plaintext key, decrypted in memory for the life of this call. Never logged. */
  apiKey: string;
  /** Overrides provider default. Required for the `compatible` provider. */
  baseUrl?: string;
  /** Abort signal from the inbound request; adapters must propagate it. */
  signal?: AbortSignal;
  /** Milliseconds before the adapter gives up establishing a connection. */
  connectTimeoutMs?: number;
  /** Extra headers for OpenAI-compatible endpoints that need them. */
  headers?: Record<string, string>;
  /** Model-specific tunables the router may set (effort, max output). */
  modelOptions?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  detail?: string;
  errorClass?: ErrorClass;
}

/**
 * Every provider is reached through this interface and nothing else. The web
 * app, the router, and the tests all depend on this shape, never on an SDK.
 *
 * Contract:
 *   - `stream` yields `start` first and terminates with `done` or throws `AdapterError`.
 *   - It never yields provider-specific event shapes.
 *   - It never logs, never persists, and never retries — retries belong to the router.
 *   - It must translate token usage into the canonical `Usage` shape, normalizing
 *     cache tokens to be *exclusive* of inputTokens.
 */
export interface ProviderAdapter {
  readonly id: Provider;

  /** Static catalog for this provider. Config-dependent models are resolved at call time. */
  listModels(): ModelInfo[];

  /** Cheap credential check used at key-creation time and by the weekly re-validation job. */
  validateCredential(config: AdapterConfig): Promise<ValidationResult>;

  /** The one method that actually talks to a model. */
  stream(
    request: ChatRequest,
    modelId: string,
    config: AdapterConfig,
  ): AsyncIterable<StreamEvent>;

  capabilities(modelId: string): Capabilities;

  /**
   * Map a thrown value onto the router's error taxonomy. Must never throw.
   * This function is where failover quality is won or lost.
   */
  classifyError(error: unknown): ErrorClass;
}

/** Shared helper: normalize a thrown SDK error into a class without leaking its message. */
export function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  if (typeof error === 'string') return error.slice(0, 500);
  return fallback;
}

/** Shared helper: pull `retry-after` from headers in either seconds or milliseconds. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    // Values below 1000 are almost always seconds; larger ones are ms.
    return numeric < 1000 ? numeric * 1000 : numeric;
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Concatenate the text of all text blocks — needed by providers with a single-string system field. */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}
