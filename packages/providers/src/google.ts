import {
  AdapterError,
  type Block,
  type Capabilities,
  type ChatRequest,
  type ErrorClass,
  type StreamEvent,
  type Usage,
  type Provider,
} from '@omnirouter/canonical';
import type {
  AdapterConfig,
  ModelInfo,
  ProviderAdapter,
  ValidationResult,
} from './types.js';
import { modelsFor } from './catalog.js';
import { blocksToText, parseRetryAfter, safeMessage } from './types.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
  thought?: boolean;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { code: number; message: string; status: string };
}

function toGeminiContents(request: ChatRequest): {
  contents: GeminiContent[];
  callNames: Map<string, string>;
} {
  const contents: GeminiContent[] = [];
  const callNames = new Map<string, string>();

  for (const message of request.messages) {
    const parts: GeminiPart[] = [];
    // Signatures are only meaningful to Google; drop ones from other providers' turns.
    const fromGoogle = message.producedBy?.provider === 'google';

    for (const block of message.blocks) {
      switch (block.type) {
        case 'text':
          parts.push({ text: block.text });
          break;
        case 'image':
          if (block.source.kind === 'base64') {
            parts.push({
              inlineData: {
                mimeType: block.source.mediaType,
                data: block.source.data,
              },
            });
          } else {
            parts.push({
              fileData: {
                mimeType: block.source.mediaType ?? 'image/jpeg',
                fileUri: block.source.url,
              },
            });
          }
          break;
        case 'tool_use':
          callNames.set(block.id, block.name);
          parts.push({
            functionCall: {
              name: block.name,
              args: (block.input ?? {}) as Record<string, unknown>,
            },
            thoughtSignature:
              fromGoogle && block.signature ? block.signature : 'skip_thought_signature_validator',
          });
          break;
        case 'tool_result':
          parts.push({
            functionResponse: {
              name: callNames.get(block.toolUseId) ?? block.toolUseId,
              response: { result: block.content },
            },
          });
          break;
      }
    }

    if (parts.length) {
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
  }

  return { contents, callNames };
}

function normalizeUsage(meta: GeminiStreamChunk['usageMetadata']): Usage {
  if (!meta) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  }
  const cached = meta.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (meta.promptTokenCount ?? 0) - cached),
    outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

export class GoogleAdapter implements ProviderAdapter {
  readonly id: Provider = 'google';

  constructor(private readonly models: ModelInfo[] = modelsFor('google')) {}

  listModels(): ModelInfo[] {
    return this.models;
  }

  capabilities(modelId: string): Capabilities {
    return (
      this.models.find((m) => m.modelId === modelId)?.capabilities ?? {
        vision: false,
        pdf: false,
        tools: false,
        structuredOutput: false,
        promptCaching: false,
        reasoning: false,
        streaming: true,
      }
    );
  }

  async validateCredential(config: AdapterConfig): Promise<ValidationResult> {
    try {
      const response = await fetch(
        `${config.baseUrl ?? API_BASE}/models?pageSize=1`,
        { headers: { 'x-goog-api-key': config.apiKey }, signal: config.signal },
      );
      if (response.ok) return { ok: true };
      const body = await response.text();
      return {
        ok: false,
        detail: body.slice(0, 300),
        errorClass: classifyHttp(response.status, body),
      };
    } catch (error) {
      return {
        ok: false,
        detail: safeMessage(error, 'credential check failed'),
        errorClass: 'unknown',
      };
    }
  }

  async *stream(
    request: ChatRequest,
    modelId: string,
    config: AdapterConfig,
  ): AsyncIterable<StreamEvent> {
    const { contents } = toGeminiContents(request);

    const generationConfig: Record<string, unknown> = {};
    if (request.maxOutputTokens) {
      generationConfig.maxOutputTokens = Math.min(
        request.maxOutputTokens,
        this.models.find((m) => m.modelId === modelId)?.maxOutputTokens ?? 65_536,
      );
    }
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (request.stopSequences?.length) {
      generationConfig.stopSequences = request.stopSequences;
    }
    if (request.outputSchema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = request.outputSchema;
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
        },
      ];
    }

    const url =
      `${config.baseUrl ?? API_BASE}/models/${encodeURIComponent(modelId)}` +
      `:streamGenerateContent?alt=sse`;

    yield { type: 'start', provider: this.id, model: modelId };

    let usage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    let finishReason = 'STOP';

    try {
      const response = await fetch(url, {
        method: 'POST',
        // Key in a header, not the URL, so it never lands in access logs.
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.apiKey,
          ...config.headers,
        },
        body: JSON.stringify(body),
        signal: config.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new AdapterError({
          class: classifyHttp(response.status, text),
          message: text.slice(0, 500) || `gemini http ${response.status}`,
          httpStatus: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          provider: this.id,
          model: modelId,
        });
      }

      if (!response.body) {
        throw new AdapterError({
          class: 'overloaded',
          message: 'gemini returned an empty body',
          provider: this.id,
          model: modelId,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let sawContent = false;
      while (true) {
        const { done, value } = await reader.read();

        buffer = (buffer + (value ? decoder.decode(value, { stream: !done }) : '')).replace(/\r\n/g, '\n');
        const frames = buffer.split('\n\n');
        // At end of stream, the last frame may lack its trailing blank line.
        buffer = done ? '' : (frames.pop() ?? '');

        for (const frame of frames) {
          const dataLine = frame
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (!dataLine) continue;

          const json = dataLine.slice(6).trim();
          if (!json || json === '[DONE]') continue;

          let chunk: GeminiStreamChunk;
          try {
            chunk = JSON.parse(json) as GeminiStreamChunk;
          } catch {
            continue;
          }

          if (chunk.error) {
            throw new AdapterError({
              class: classifyHttp(chunk.error.code, chunk.error.message),
              message: chunk.error.message,
              httpStatus: chunk.error.code,
              provider: this.id,
              model: modelId,
            });
          }

          if (chunk.usageMetadata) usage = normalizeUsage(chunk.usageMetadata);

          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;
          if (candidate.finishReason) finishReason = candidate.finishReason;

          for (const part of candidate.content?.parts ?? []) {
            if (typeof part.text === 'string' && part.text) {
              sawContent = true;
              if (part.thought) yield { type: 'thinking_delta', text: part.text };
              else yield { type: 'text_delta', text: part.text };
            }
            if (part.functionCall) {
              sawContent = true;
              yield {
                type: 'tool_call',
                id: `call_${Math.random().toString(36).slice(2, 12)}`,
                name: part.functionCall.name,
                input: part.functionCall.args ?? {},
                ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
              };
            }
          }
        }
        if (done) break;
      }

      if (!sawContent && finishReason !== 'MAX_TOKENS') {
        throw new AdapterError({
          class: finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' ? 'content_filter' : 'unknown',
          message: `gemini returned no content (finishReason ${finishReason})`,
          provider: this.id,
          model: modelId,
        });
      }

      yield { type: 'usage', usage };
      yield { type: 'done', stopReason: mapFinishReason(finishReason) };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      if ((error as Error)?.name === 'AbortError') {
        throw new AdapterError({
          class: 'timeout',
          message: 'request aborted',
          provider: this.id,
          model: modelId,
        });
      }
      throw new AdapterError({
        class: 'unknown',
        message: safeMessage(error, 'gemini request failed'),
        provider: this.id,
        model: modelId,
        cause: error,
      });
    }
  }

  classifyError(error: unknown): ErrorClass {
    if (error instanceof AdapterError) return error.class;
    return 'unknown';
  }
}

export function classifyHttp(status: number, message: string): ErrorClass {
  const lower = (message ?? '').toLowerCase();
  if (status === 400) {
    if (lower.includes('token') && lower.includes('exceed')) return 'context_too_long';
    if (lower.includes('api key')) return 'auth';
    return 'invalid_request';
  }
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'invalid_request';
  if (status === 429) {
    return lower.includes('quota') && lower.includes('exceed') && lower.includes('day')
      ? 'quota'
      : 'rate_limit';
  }
  if (status === 408) return 'timeout';
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return 'overloaded';
  }
  return 'unknown';
}

function mapFinishReason(
  reason: string,
): 'end_turn' | 'max_tokens' | 'tool_use' | 'content_filter' | 'refusal' {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    case 'OTHER':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

export const __test = { toGeminiContents, normalizeUsage, classifyHttp, blocksToText };
