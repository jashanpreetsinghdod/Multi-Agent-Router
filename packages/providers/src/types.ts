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
  modelId: string;
  routerId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Capabilities;
  pricing: {
    inputPerMTok: number;
    outputPerMTok: number;
    cacheReadPerMTok?: number;
    cacheWritePerMTok?: number;
  } | null;
  status: 'available' | 'deprecated' | 'unavailable';
}

export interface AdapterConfig {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  headers?: Record<string, string>;
  modelOptions?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  detail?: string;
  errorClass?: ErrorClass;
}

export interface ProviderAdapter {
  readonly id: Provider;

  listModels(): ModelInfo[];

  validateCredential(config: AdapterConfig): Promise<ValidationResult>;

  stream(
    request: ChatRequest,
    modelId: string,
    config: AdapterConfig,
  ): AsyncIterable<StreamEvent>;

  capabilities(modelId: string): Capabilities;

  classifyError(error: unknown): ErrorClass;
}

export function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  if (typeof error === 'string') return error.slice(0, 500);
  return fallback;
}

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

export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}
