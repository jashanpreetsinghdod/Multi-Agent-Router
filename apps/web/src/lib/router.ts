import type {
  Block,
  ChatRequest,
  CanonicalMessage,
  RouterEvent,
  Usage,
} from '@omnirouter/canonical';
import { encodeSse } from '@omnirouter/canonical';
import { registry, QUALITY_PRIOR, type ModelInfo } from '@omnirouter/providers';
import {
  buildDecision,
  runCascade,
  InMemoryHealthStore,
  taskFamily,
  DEFAULT_WEIGHTS,
  type CascadeResult,
  type RoutingWeights,
} from '@omnirouter/router-core';
import {
  BUILTIN_TOOLS,
  ToolRegistry,
  webSearchConfigured,
} from '@omnirouter/tools';
import type { AttemptRecord, RouterModel } from '@omnirouter/router-core';
import { getStore } from './store';

const globalHealth = globalThis as unknown as { __omniHealth?: InMemoryHealthStore };
const health = (globalHealth.__omniHealth ??= new InMemoryHealthStore());

const tools = new ToolRegistry();

const MAX_TOOL_STEPS = 5;
const TOOL_TIMEOUT_MS = 20_000;

export interface StreamChatOptions {
  owner: string;
  request: ChatRequest;
  modelPolicy: string;
  messageId: string;
  signal?: AbortSignal;
  enableTools?: boolean;
  /** USD left under the user's monthly cap; undefined = no cap. */
  budgetUsd?: number;
}

export interface ChatOutcome extends CascadeResult {
  text: string;
  switched: boolean;
  totalUsage: Usage;
  runId: string;
  allAttempts: AttemptRecord[];
  routedReason?: string;
}

function policyProfile(policy: string): {
  weights: RoutingWeights;
  hints: ChatRequest['hints'];
} {
  if (policy === 'auto:cheap') {
    return { weights: { ...DEFAULT_WEIGHTS, quality: 0.6, cost: 1.2 }, hints: undefined };
  }
  if (policy === 'auto:fast') {
    return { weights: { ...DEFAULT_WEIGHTS, latency: 0.6 }, hints: { preferSpeed: true } };
  }
  return { weights: DEFAULT_WEIGHTS, hints: undefined };
}

function toolSystemNote(): string {
  const today = new Date().toISOString().slice(0, 10);
  const search = webSearchConfigured()
    ? 'Use web_search for anything that may have changed after your training cutoff (news, prices, versions, recent events), then cite the URLs you used.'
    : 'Live web search is not configured on this server; you can still read a specific page with fetch_url if the user gives you a URL.';
  return `Today's date is ${today}. ${search}`;
}

export function streamChat(opts: StreamChatOptions): {
  stream: ReadableStream<Uint8Array>;
  outcome: Promise<ChatOutcome>;
} {
  const { owner, modelPolicy, messageId, signal } = opts;
  const store = getStore();
  const encoder = new TextEncoder();

  let resolveOutcome!: (o: ChatOutcome) => void;
  const outcome = new Promise<ChatOutcome>((r) => (resolveOutcome = r));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seq = 0;
      let closed = false;
      const send = (event: RouterEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event)));
        } catch {
          closed = true; // client went away
        }
      };

      const runId = crypto.randomUUID();
      const allAttempts: AttemptRecord[] = [];
      let routedReason: string | undefined;
      // Decrypted keys are cached only for the life of this request.
      const keyCache = new Map<string, string>();
      const baseUrls = new Map<string, string | undefined>();
      const models: RouterModel[] = [];
      const { weights, hints } = policyProfile(modelPolicy);
      const family = taskFamily(opts.request);
      const qualityPrior = QUALITY_PRIOR[family] ?? QUALITY_PRIOR['general'] ?? {};

      let request: ChatRequest = {
        ...opts.request,
        ...(hints || opts.request.hints ? { hints: { ...opts.request.hints, ...hints } } : {}),
      };
      if (opts.enableTools) {
        const offered = BUILTIN_TOOLS.filter(
          (t) => t.name !== 'web_search' || webSearchConfigured(),
        );
        request = {
          ...request,
          tools: [...(request.tools ?? []), ...offered],
          system: [request.system, toolSystemNote()].filter(Boolean).join('\n\n'),
        };
      }

      let text = '';
      let switched = false;
      let totalCost = 0;
      const totalUsage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let result: CascadeResult = { ok: false, totalCostUsd: 0, attempts: [] };

      try {
        for (const cred of await store.listCredentials(owner)) {
          baseUrls.set(cred.id, cred.baseUrl);
          const enabled = new Set(cred.enabledModelIds);
          for (const m of cred.models) {
            if (enabled.has(m.modelId)) models.push({ ...m, enabledByUser: true, credentialId: cred.id });
          }
        }
        const keyFor = async (credentialId: string): Promise<string> => {
          const cached = keyCache.get(credentialId);
          if (cached) return cached;
          const key = await store.credentialSecret(owner, credentialId);
          if (!key) throw new Error('This API key was removed. Add it again in Settings.');
          keyCache.set(credentialId, key);
          return key;
        };

        for (let step = 0; step < MAX_TOOL_STEPS; step++) {
          let decision = await buildDecision({
            request, models, modelPolicy, health, qualityPrior, weights,
          });
          // If no enabled model can call tools, answer without them rather than fail.
          if (decision.failure?.code === 'no_capability' && opts.enableTools && step === 0) {
            const { tools: _dropped, ...rest } = request;
            request = rest;
            decision = await buildDecision({
              request, models, modelPolicy, health, qualityPrior, weights,
            });
          }

          let stepText = '';
          result = await runCascade(
            { request, decision, runId, messageId, startSeq: seq },
            {
              adapterFor: (p) => registry.get(p),
              keyFor: (_p, credentialId) => keyFor(credentialId),
              baseUrlFor: (_p, credentialId) => baseUrls.get(credentialId),
              health,
              pricingFor: (model: ModelInfo) => model.pricing,
              relay: (event: RouterEvent) => {
                seq = event.seq + 1;
                // `done` is emitted once, by us, after the whole tool loop.
                if (event.event === 'done') return;
                if (event.event === 'delta') stepText += event.text;
                if (event.event === 'routed' && routedReason === undefined) routedReason = event.reason;
                if (event.event === 'status' && event.phase === 'switched') switched = true;
                send(event);
              },
              ...(signal ? { signal } : {}),
              ...(opts.budgetUsd !== undefined ? { budgetUsd: Math.max(0, opts.budgetUsd - totalCost) } : {}),
              includeThinking: true,
            },
          );

          text += stepText;
          allAttempts.push(...result.attempts);
          totalCost += result.totalCostUsd;
          if (result.usage) addUsage(totalUsage, result.usage);
          send({ event: 'usage', seq: seq++, usage: totalUsage, costUsd: totalCost });

          const calls = result.toolCalls ?? [];
          if (!result.ok || calls.length === 0 || signal?.aborted) break;
          if (opts.budgetUsd !== undefined && totalCost >= opts.budgetUsd) break;

          // Run the requested tools and append both turns to the history.
          const results = await Promise.all(
            calls.map(async (call) => {
              const r = await withTimeout(
                tools.execute(call.name, (call.input ?? {}) as Record<string, unknown>),
                TOOL_TIMEOUT_MS,
              );
              send({
                event: 'tool',
                seq: seq++,
                id: call.id,
                name: call.name,
                state: 'result',
                preview: r.content.slice(0, 200),
              });
              return { call, r };
            }),
          );

          const assistantBlocks: Block[] = [
            ...(stepText ? [{ type: 'text' as const, text: stepText }] : []),
            ...calls.map((c) => ({
              type: 'tool_use' as const,
              id: c.id,
              name: c.name,
              input: c.input,
              ...(c.signature ? { signature: c.signature } : {}),
            })),
          ];
          const resultBlocks: Block[] = results.map(({ call, r }) => ({
            type: 'tool_result' as const,
            toolUseId: call.id,
            content: r.content,
            ...(r.isError ? { isError: true } : {}),
          }));
          const turns: CanonicalMessage[] = [
            {
              role: 'assistant',
              blocks: assistantBlocks,
              ...(result.provider && result.model
                ? { producedBy: { provider: result.provider, model: result.model } }
                : {}),
            },
            { role: 'user', blocks: resultBlocks },
          ];
          request = {
            ...request,
            messages: [...request.messages, ...turns],
            // On the last allowed step, force a written answer.
            ...(step + 2 >= MAX_TOOL_STEPS ? { toolChoice: 'none' as const } : {}),
          };
          if (stepText && !stepText.endsWith('\n')) text += '\n\n';
        }

        if (result.ok) {
          send({
            event: 'done',
            seq: seq++,
            messageId,
            runId,
            stopReason: result.stopReason ?? 'end_turn',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        send({ event: 'error', seq: seq++, errorClass: 'unknown', message, attempts: [] });
        result = { ok: false, totalCostUsd: totalCost, attempts: [], error: { class: 'unknown', message } };
      } finally {
        resolveOutcome({
          ...result,
          totalCostUsd: totalCost,
          text,
          switched,
          totalUsage,
          runId,
          allAttempts,
          ...(routedReason ? { routedReason } : {}),
        });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return { stream, outcome };
}

function addUsage(into: Usage, u: Usage): void {
  into.inputTokens += u.inputTokens;
  into.outputTokens += u.outputTokens;
  into.cacheReadTokens += u.cacheReadTokens;
  into.cacheWriteTokens += u.cacheWriteTokens;
}

async function withTimeout(
  p: Promise<{ content: string; isError?: boolean }>,
  ms: number,
): Promise<{ content: string; isError?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ content: string; isError: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ content: `Tool timed out after ${ms / 1000}s`, isError: true }), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
