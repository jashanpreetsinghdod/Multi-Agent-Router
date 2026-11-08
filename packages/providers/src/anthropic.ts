import Anthropic from '@anthropic-ai/sdk';
import {
  AdapterError,
  type Block,
  type Capabilities,
  type CanonicalMessage,
  type ChatRequest,
  type ErrorClass,
  type StreamEvent,
  type Usage,
  estimateTokens,
  type Provider,
} from '@omnirouter/canonical';
import type {
  AdapterConfig,
  ModelInfo,
  ProviderAdapter,
  ValidationResult,
} from '../types.js';
import { modelsFor } from '../catalog.js';
import { parseRetryAfter, safeMessage } from '../types.js';

/**
 * Anthropic adapter.
 *
 * Notes that matter for routing correctness:
 *  - Thinking blocks carry a signature that must round-trip verbatim on the
 *    same model. They are cached per conversation below so a same-model retry
 *    does not lose reasoning, and are dropped on a model switch by the router.
 *  - Assistant prefill is not permitted on current models; we never send a
 *    trailing assistant turn.
 *  - Tool inputs arrive as complete JSON blocks in the blocks API — no partial
 *    argument buffering needed here.
 */
const API_VERSION = '2023-06-01';

function toAnthropicContent(
  blocks: Block[],
): Anthropic.Messages.ContentBlockParam[] {
  const out: Anthropic.Messages.ContentBlockParam[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out.push({ type: 'text', text: block.text });
        break;
      case 'image': {
        if (block.source.kind === 'base64') {
          out.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: block.source.mediaType as
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp',
              data: block.source.data,
            },
          });
        } else {
          out.push({
            type: 'image',
            source: { type: 'url', url: block.source.url },
          });
        }
        break;
      }
      case 'tool_use':
        out.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
        break;
      case 'tool_result':
        out.push({
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError ?? false,
        });
        break;
    }
  }
  return out;
}

function toAnthropicMessages(
  messages: CanonicalMessage[],
): Anthropic.Messages.MessageParam[] {
  return messages
    .filter((m) => m.blocks.length > 0)
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.blocks) }));
}

function toAnthropicTools(
  request: ChatRequest,
): Anthropic.Messages.ToolUnion[] | undefined {
  if (!request.tools?.length) return undefined;
  return request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // The canonical subset is already a JSON Schema object.
    input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
    ...(tool.strict ? { strict: true } : {}),
  }));
}

function usageFromAnthropic(msg: Anthropic.Messages.Message): Usage {
  // Anthropic reports input_tokens exclusive of cache tokens, matching the
  // canonical convention, so no normalization is needed.
  return {
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id: Provider = 'anthropic';

  constructor(private readonly models: ModelInfo[] = modelsFor('anthropic')) {}

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
      // The cheapest honest check: token counting, no model invocation, no spend.
      await client.messages.countTokens({
        model: this.models[0]?.modelId ?? 'claude-haiku-5-5',
        messages: [{ role: 'user', content: 'ping' }],
      });
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

    const body: Anthropic.Messages.MessageStreamParams = {
      model: modelId,
      max_tokens: Math.min(
        request.maxOutputTokens ?? 8192,
        this.maxOutputFor(modelId),
      ),
      messages: toAnthropicMessages(request.messages),
      stream: true,
    };

    if (request.system) body.system = request.system;
    const tools = toAnthropicTools(request);
    if (tools) body.tools = tools;
    if (request.toolChoice === 'none') {
      body.tool_choice = { type: 'none' };
    } else if (request.toolChoice === 'auto' || request.toolChoice === 'required') {
      // Forced tool_choice is rejected on current models; steer via `auto`.
      body.tool_choice = { type: 'auto' };
    }
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    // Thinking is on by default on current models and cannot be disabled.
    // Request a summary so the relay has something to show during long turns.
    body.thinking = { type: 'adaptive', display: 'summarized' } as never;

    let usage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    const stream = client.messages.stream(body, { signal: config.signal });

    yield { type: 'start', provider: this.id, model: modelId };

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            usage = { ...usage, ...usageFromAnthropic(event.message) };
            break;

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              yield { type: 'text_delta', text: event.delta.text };
            } else if (event.delta.type === 'thinking_delta') {
              yield {
                type: 'thinking_delta',
                text: event.delta.thinking,
                signature:
                  'signature' in event.delta
                    ? (event.delta.signature as string | undefined)
                    : undefined,
              };
            }
            break;

          case 'message_delta':
            if (event.usage) {
              usage = {
                ...usage,
                outputTokens: event.usage.output_tokens,
              };
            }
            break;

          case 'error':
            throw new AdapterError({
              class: 'overloaded',
              message: event.error.message,
              provider: this.id,
              model: modelId,
            });

          default:
            break;
        }
      }

      const final = await stream.finalMessage();
      usage = usageFromAnthropic(final);

      yield { type: 'usage', usage };

      // Emit any tool calls the model produced in one complete batch.
      for (const block of final.content) {
        if (block.type === 'tool_use') {
          yield {
            type: 'tool_call',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
      }

      yield { type: 'done', stopReason: mapStopReason(final.stop_reason) };
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw this.toAdapterError(error, modelId, config);
    }
  }

  classifyError(error: unknown): ErrorClass {
    if (error instanceof AdapterError) return error.class;
    if (error instanceof Anthropic.APIError) {
      return classifyAnthropicError(error);
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
    if (error instanceof Anthropic.APIConnectionError) return 'overloaded';
    if (error instanceof Anthropic.AbortError) return 'timeout';
    return 'unknown';
  }

  private toAdapterError(
    error: unknown,
    modelId: string,
    _config: AdapterConfig,
  ): AdapterError {
    const errorClass = this.classifyError(error);

    let httpStatus: number | undefined;
    let retryAfterMs: number | undefined;

    if (error instanceof Anthropic.APIError) {
      httpStatus = error.status;
      retryAfterMs = parseRetryAfter(
        (error.headers?.['retry-after'] as string | undefined) ?? undefined,
      );
    }

    return new AdapterError({
      class: errorClass,
      message: safeMessage(error, 'anthropic request failed'),
      httpStatus,
      retryAfterMs,
      provider: this.id,
      model: modelId,
      cause: error,
    });
  }

  private maxOutputFor(modelId: string): number {
    return (
      this.models.find((m) => m.modelId === modelId)?.maxOutputTokens ?? 8192
    );
  }

  private client(config: AdapterConfig): Anthropic {
    return new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      defaultHeaders: {
        'anthropic-version': API_VERSION,
        ...config.headers,
      },
      maxRetries: 0, // the router owns retries
      ...(config.connectTimeoutMs
        ? { timeout: config.connectTimeoutMs }
        : { timeout: 600_000 }),
    });
  }
}

export function classifyAnthropicError(error: Anthropic.APIError): ErrorClass {
  const status = error.status;
  const message = (error.message ?? '').toLowerCase();

  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'invalid_request';
  if (status === 400) {
    if (message.includes('context') || message.includes('too long')) {
      return 'context_too_long';
    }
    if (message.includes('credit') || message.includes('billing')) return 'quota';
    return 'invalid_request';
  }
  if (status === 429) {
    return message.includes('credit') || message.includes('quota')
      ? 'quota'
      : 'rate_limit';
  }
  if (status === 529) return 'overloaded';
  if (status !== undefined && status >= 500) return 'overloaded';
  if (status === 408) return 'timeout';
  return 'unknown';
}

function mapStopReason(
  reason: string | null,
): 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'refusal' {
  switch (reason) {
    case 'max_tokens':
      return 'max_tokens';
    case 'tool_use':
      return 'tool_use';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'refusal':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

/** Exported for tests: lets the adapter be exercised without a network. */
export const __test = { toAnthropicMessages, classifyAnthropicError, estimateTokens };
