import {
  AdapterError,
  type Capabilities,
  type ChatRequest,
  type ErrorClass,
  type Provider,
  type StreamEvent,
  type Usage,
} from '@omnirouter/canonical';
import type { ModelInfo, ProviderAdapter, ValidationResult } from '@omnirouter/providers';

export type FakeBehavior =
  | { kind: 'ok'; text?: string; toolCall?: { id: string; name: string; input: unknown } }
  | { kind: 'error_before_output'; errorClass: ErrorClass; retryAfterMs?: number }
  | {
      kind: 'error_mid_stream';
      errorClass: ErrorClass;
      charsBeforeDeath: number;
      text?: string;
    }
  | { kind: 'context_too_long' };

export class FakeAdapter implements ProviderAdapter {
  readonly id: Provider;

  readonly requests: Array<{ model: string; request: ChatRequest }> = [];

  constructor(
    id: Provider,
    private readonly models: ModelInfo[] = defaultFakeModels(id),
    private readonly behaviors: Map<string, FakeBehavior[]> = new Map(),
  ) {
    this.id = id;
  }

  queue(modelId: string, ...behaviors: FakeBehavior[]): void {
    const existing = this.behaviors.get(modelId) ?? [];
    existing.push(...behaviors);
    this.behaviors.set(modelId, existing);
  }

  listModels(): ModelInfo[] {
    return this.models;
  }

  capabilities(modelId: string): Capabilities {
    return (
      this.models.find((m) => m.modelId === modelId)?.capabilities ??
      emptyCapabilities()
    );
  }

  async validateCredential(_config: unknown): Promise<ValidationResult> {
    return { ok: true };
  }

  async *stream(
    request: ChatRequest,
    modelId: string,
    _config: { apiKey?: string },
  ): AsyncIterable<StreamEvent> {
    this.requests.push({ model: modelId, request });
    const queue = this.behaviors.get(modelId);
    const behavior: FakeBehavior =
      queue && queue.length > 0 ? (queue.shift() as FakeBehavior) : { kind: 'ok' };

    yield { type: 'start', provider: this.id, model: modelId };

    switch (behavior.kind) {
      case 'ok':
        yield { type: 'text_delta', text: behavior.text ?? 'ok from ' + modelId };
        if (behavior.toolCall) {
          yield {
            type: 'tool_call',
            id: behavior.toolCall.id,
            name: behavior.toolCall.name,
            input: behavior.toolCall.input,
          };
        }
        yield {
          type: 'usage',
          usage: usageFor(behavior.text ?? 'ok'),
        };
        yield {
          type: 'done',
          stopReason: behavior.toolCall ? 'tool_use' : 'end_turn',
        };
        return;

      case 'error_before_output':
        throw new AdapterError({
          class: behavior.errorClass,
          message: `scripted ${behavior.errorClass}`,
          retryAfterMs: behavior.retryAfterMs,
          provider: this.id,
          model: modelId,
        });

      case 'error_mid_stream': {
        const text = behavior.text ?? 'This answer should have been much longer and covered'.repeat(20);
        let emitted = 0;
        while (emitted < behavior.charsBeforeDeath) {
          const slice = text.slice(emitted, emitted + 10);
          if (!slice) break;
          yield { type: 'text_delta', text: slice };
          emitted += slice.length;
        }
        throw new AdapterError({
          class: behavior.errorClass,
          message: `stream died after ${emitted} chars`,
          provider: this.id,
          model: modelId,
        });
      }

      case 'context_too_long':
        throw new AdapterError({
          class: 'context_too_long',
          message: 'prompt is too long',
          provider: this.id,
          model: modelId,
        });
    }
  }

  classifyError(error: unknown): ErrorClass {
    if (error instanceof AdapterError) return error.class;
    return 'unknown';
  }
}

function usageFor(text: string): Usage {
  return {
    inputTokens: 50,
    outputTokens: Math.max(1, Math.ceil(text.length / 4)),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function emptyCapabilities(): Capabilities {
  return {
    vision: false,
    pdf: false,
    tools: false,
    structuredOutput: false,
    promptCaching: false,
    reasoning: false,
    streaming: true,
  };
}

export function defaultFakeModels(provider: Provider): ModelInfo[] {
  const capabilities = {
    ...emptyCapabilities(),
    vision: true,
    pdf: true,
    tools: true,
    structuredOutput: true,
    promptCaching: true,
    reasoning: true,
  };
  return [
    {
      provider,
      modelId: 'fake-large',
      routerId: `${provider}/fake-large`,
      displayName: `Fake Large (${provider})`,
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      capabilities,
      pricing: { inputPerMTok: 5, outputPerMTok: 25 },
      status: 'available',
    },
    {
      provider,
      modelId: 'fake-small',
      routerId: `${provider}/fake-small`,
      displayName: `Fake Small (${provider})`,
      contextWindow: 128_000,
      maxOutputTokens: 4_096,
      capabilities,
      pricing: { inputPerMTok: 0.5, outputPerMTok: 2 },
      status: 'available',
    },
  ];
}
