import OpenAI from 'openai';
import {
  AdapterError,
  type Block,
  type Capabilities,
  type CanonicalMessage,
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
} from '../types.js';
import { modelsFor } from '../catalog.js';
import { blocksToText, parseRetryAfter, safeMessage } from '../types.js';

/**
 * OpenAI adapter, also the base for any OpenAI-compatible endpoint (Groq,
 * OpenRouter, vLLM, LM Studio). Subclass or construct with a different baseUrl.
 *
 * Two provider behaviours handled here that bite in production:
 *  - `cached_tokens` is a subset of `prompt_tokens`. The canonical Usage wants
 *    cache tokens exclusive of input, so they are subtracted.
 *  - `finish_reason: 'length'` mid-tool-call leaves unterminated JSON. Tool
 *    arguments are buffered and only emitted when the index completes.
 */
function toOpenAiMessages(
  request: ChatRequest,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (request.system) {
    out.push({ role: 'system', content: request.system });
  }

  for (const message of request.messages) {
    const images = message.blocks.filter(
      (b): b is Extract<Block, { type: 'image' }> => b.type === 'image',
    );
    const toolCalls = message.blocks.filter(
      (b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    const toolResults = message.blocks.filter(
      (b): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result',
    );

    if (message.role === 'assistant') {
      const text = blocksToText(message.blocks);
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.input ?? {}),
                },
              })),
            }
          : {}),
      });
      continue;
    }

    // Tool results are their own `tool` messages in the OpenAI format.
    for (const result of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: result.toolUseId,
        content: result.content,
      });
    }

    const text = blocksToText(message.blocks);
    if (images.length) {
      out.push({
        role: 'user',
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...images.map((image) =>
            image.source.kind === 'base64'
              ? {
                  type: 'image_url' as const,
                  image_url: {
                    url: `data:${image.source.mediaType};base64,${image.source.data}`,
                  },
                }
              : {
                  type: 'image_url' as const,
                  image_url: { url: image.source.url },
                },
          ),
        ],
      });
    } else if (text || toolResults.length === 0) {
      out.push({ role: 'user', content: text });
    }
  }

  return out;
}

function toOpenAiTools(
  request: ChatRequest,
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (!request.tools?.length) return undefined;
  return request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }));
}

function normalizeUsage(usage: OpenAI.CompletionUsage | undefined): Usage {
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  }
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, usage.prompt_tokens - cached),
    outputTokens: usage.completion_tokens,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

export class OpenAiAdapter implements ProviderAdapter {
  readonly id: Provider;

  constructor(
    private readonly models: ModelInfo[] = modelsFor('openai'),
    id: Provider = 'openai',
  ) {
    this.id = id;
  }

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
      const client = this.client(config);
      await client.models.list();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        detail: safeMessage(error, 'credential check failed'),
        errorClass: this.classifyError(error),
      };
    }
  }

  async *stream(
    request: ChatRequest,
    modelId: string,
    config: AdapterConfig,
  ): AsyncIterable<StreamEvent> {
    const client = this.client(config);

    const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: modelId,
      messages: toOpenAiMessages(request),
      stream: true,
      stream_options: { include_usage: true },
    };

    const tools = toOpenAiTools(request);
    if (tools) {
      body.tools = tools;
      body.tool_choice =
        request.toolChoice === 'none'
          ? 'none'
          : request.toolChoice === 'required'
            ? 'required'
            : 'auto';
    }
    if (request.maxOutputTokens) {
      body.max_completion_tokens = Math.min(
        request.maxOutputTokens,
        this.models.find((m) => m.modelId === modelId)?.maxOutputTokens ?? 16_384,
      );
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences?.length) body.stop = request.stopSequences;

    if (request.outputSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: request.outputSchema,
        },
      };
    }

    let usage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    let finishReason: string | null = null;

    // Tool-call argument fragments accumulate per index until finish.
    const toolBuffers = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    yield { type: 'start', provider: this.id, model: modelId };

    try {
      const stream = await client.chat.completions.create(body, {
        signal: config.signal,
      });

      for await (const chunk of stream) {
        if (chunk.usage) usage = normalizeUsage(chunk.usage);

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text_delta', text: delta.content };
        }

        for (const call of delta.tool_calls ?? []) {
          const index = call.index ?? 0;
          const existing = toolBuffers.get(index) ?? {
            id: '',
            name: '',
            args: '',
          };
          toolBuffers.set(index, {
            id: call.id ?? existing.id,
            name: call.function?.name ?? existing.name,
            args: existing.args + (call.function?.arguments ?? ''),
          });
        }
      }

      for (const [, buffered] of [...toolBuffers.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        let input: unknown = {};
        if (buffered.args) {
          try {
            input = JSON.parse(buffered.args);
          } catch {
            throw new AdapterError({
              class: 'invalid_request',
              message: `malformed tool arguments for ${buffered.name}`,
              provider: this.id,
              model: modelId,
            });
          }
        }
        yield {
          type: 'tool_call',
          id: buffered.id || `call_${Math.random().toString(36).slice(2)}`,
          name: buffered.name,
          input,
        };
      }

      yield { type: 'usage', usage };
      yield { type: 'done', stopReason: mapFinishReason(finishReason) };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw this.toAdapterError(error, modelId);
    }
  }

  classifyError(error: unknown): ErrorClass {
    if (error instanceof AdapterError) return error.class;
    if (error instanceof OpenAI.APIError) return classifyOpenAiError(error);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return 'timeout';
    if (error instanceof OpenAI.APIConnectionError) return 'overloaded';
    if (error instanceof OpenAI.APIUserAbortError) return 'timeout';
    return 'unknown';
  }

  private toAdapterError(error: unknown, modelId: string): AdapterError {
    let httpStatus: number | undefined;
    let retryAfterMs: number | undefined;

    if (error instanceof OpenAI.APIError) {
      httpStatus = error.status;
      const headers = error.headers as unknown as
        | Record<string, string | undefined>
        | undefined;
      retryAfterMs = parseRetryAfter(headers?.['retry-after']);
    }

    return new AdapterError({
      class: this.classifyError(error),
      message: safeMessage(error, 'openai request failed'),
      httpStatus,
      retryAfterMs,
      provider: this.id,
      model: modelId,
      cause: error,
    });
  }

  private client(config: AdapterConfig): OpenAI {
    return new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      maxRetries: 0,
      ...(config.connectTimeoutMs
        ? { timeout: config.connectTimeoutMs }
        : { timeout: 600_000 }),
      ...(config.headers ? { defaultHeaders: config.headers } : {}),
    });
  }
}

export function classifyOpenAiError(error: OpenAI.APIError): ErrorClass {
  const status = error.status;
  const code = String(
    (error as { code?: string | null }).code ?? '',
  ).toLowerCase();
  const message = (error.message ?? '').toLowerCase();

  if (status === 401 || status === 403) return 'auth';
  if (status === 404) {
    return code === 'model_not_found' ? 'invalid_request' : 'invalid_request';
  }
  if (status === 400) {
    if (
      code === 'context_length_exceeded' ||
      message.includes('maximum context length') ||
      message.includes('context window')
    ) {
      return 'context_too_long';
    }
    return 'invalid_request';
  }
  if (status === 429) {
    return code === 'insufficient_quota' || message.includes('quota')
      ? 'quota'
      : 'rate_limit';
  }
  if (status !== undefined && status >= 500) return 'overloaded';
  if (status === 408) return 'timeout';
  return 'unknown';
}

function mapFinishReason(
  reason: string | null,
): 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'content_filter' {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'stop':
      return 'stop_sequence';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'end_turn';
  }
}

/** Adapter for any OpenAI-compatible endpoint. Requires a baseUrl per credential. */
export class OpenAiCompatibleAdapter extends OpenAiAdapter {
  constructor(models: ModelInfo[] = []) {
    super(models, 'compatible');
  }
}

export const __test = { toOpenAiMessages, normalizeUsage, classifyOpenAiError };
