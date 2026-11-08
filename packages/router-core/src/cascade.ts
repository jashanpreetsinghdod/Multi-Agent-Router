import {
  computeCostUsd,
  failsOver,
  AdapterError,
  type ChatRequest,
  type ErrorClass,
  type Pricing,
  type Provider,
  type RouterEvent,
  type Usage,
} from '@omnirouter/canonical';
import type { ModelInfo, ProviderAdapter } from '@omnirouter/providers';
import { buildContinuationRequest, compactRequest } from './compaction.js';
import type { HealthProbe, RoutingDecision } from './types.js';

/**
 * One attempt through the cascade, as recorded in the `runs` table. Every
 * attempt — including skips and the successful one — produces a row, so the
 * cost and health queries always see the whole story.
 */
export interface AttemptRecord {
  index: number;
  provider: Provider;
  model: string;
  status: 'success' | 'failed' | 'skipped' | 'switched';
  errorClass?: ErrorClass;
  httpStatus?: number;
  message?: string;
  /** Milliseconds from attempt start to first meaningful output. */
  ttftMs?: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
}

export interface CascadeResult {
  ok: boolean;
  /** The model that produced the final answer, if any. */
  provider?: Provider;
  model?: string;
  stopReason?: string;
  usage?: Usage;
  totalCostUsd: number;
  attempts: AttemptRecord[];
  /** Set when the cascade stopped; suitable for a support ticket. */
  error?: { class: ErrorClass; message: string };
}

export interface CascadeDeps {
  adapterFor(provider: Provider): ProviderAdapter;
  keyFor(provider: Provider): Promise<string>;
  baseUrlFor?(provider: Provider): string | undefined;
  health: HealthProbe;
  pricingFor(model: ModelInfo): Pricing | null;
  relay(event: RouterEvent): Promise<void> | void;
  signal?: AbortSignal;
  /** When set, the cascade stops adding paid attempts past this total USD. */
  budgetUsd?: number;
  includeThinking?: boolean;
}

export interface CascadeRequest {
  request: ChatRequest;
  decision: RoutingDecision;
  runId: string;
  messageId?: string;
  startSeq?: number;
}

/**
 * Run the routing decision, one candidate at a time, applying the plan's
 * failure semantics:
 *
 *   before first output  → silent failover, one status line
 *   after first output   → visible handoff; the next model continues the reply
 *   auth / refusal       → stop, no failover
 *   context_too_long     → compact, retry same candidate once, then cascade
 *   all exhausted        → structured error listing every attempt
 *
 * The cascade owns the provider side of the tool loop only: it relays
 * `tool_call` events and stops on `tool_use`. Executing the tool and feeding
 * the result back is the app layer's job, which then calls the cascade again
 * with the extended request.
 */
export async function runCascade(
  input: CascadeRequest,
  deps: CascadeDeps,
): Promise<CascadeResult> {
  const { request, decision, runId, messageId } = input;
  const { health } = deps;
  let seq = input.startSeq ?? 0;

  const relay = (event: UnsequencedRouterEvent): Promise<void> => {
    const frame = { ...event, seq: seq++ } as RouterEvent;
    return Promise.resolve(deps.relay(frame));
  };

  const attempts: AttemptRecord[] = [];
  let totalCost = 0;
  let runningRequest = request;
  let pendingContinuation:
    | { partialText: string; from: { provider: string; model: string } }
    | undefined;

  const candidates = decision.candidates;

  if (candidates.length === 0) {
    const failure = decision.failure!;
    await relay({
      event: 'error',
      errorClass: failure.code,
      message: failure.message,
      attempts: [],
    });
    return {
      ok: false,
      totalCostUsd: totalCost,
      attempts,
      error: { class: failure.code as ErrorClass, message: failure.message },
    };
  }

  // Announce the first candidate up front so the UI shows intent, not a hang.
  const [first] = candidates;
  await relay({
    event: 'routed',
    runId,
    model: first.model.routerId,
    provider: first.provider,
    reason: decision.rationale || first.reason,
    fallbacks: candidates.slice(1, 4).map((c) => c.model.routerId),
  });

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    const model = candidate.model;
    const now = Date.now();

    // Re-check health — it may have opened since the decision was built.
    const probe = await health.get(candidate.credentialId);
    const cooling = probe !== undefined && probe.cooldownUntil > now;
    if (cooling && index < candidates.length - 1) {
      attempts.push(skippedAttempt(index, candidate, 'provider cooling down'));
      continue;
    }

    // A mid-stream handoff from a previous candidate: rebuild the request so
    // this model finishes the interrupted reply rather than starting fresh.
    if (pendingContinuation) {
      runningRequest = buildContinuationRequest(runningRequest, pendingContinuation);
      pendingContinuation = undefined;
    }

    // Budget gate: if we have already spent the user's cap, don't burn more.
    if (deps.budgetUsd !== undefined && totalCost >= deps.budgetUsd) {
      attempts.push(skippedAttempt(index, candidate, 'request budget exhausted'));
      continue;
    }

    let outcome: CandidateOutcome;
    let usedCompactRetry = false;
    try {
      const apiKey = await deps.keyFor(candidate.provider);
      outcome = await attemptCandidate({
        adapter: deps.adapterFor(candidate.provider),
        apiKey,
        baseUrl: deps.baseUrlFor?.(candidate.provider),
        request: runningRequest,
        model,
        health,
        credentialId: candidate.credentialId,
        deps,
        relay,
      });
    } catch (error) {
      // A throw outside the normal adapter error path is a bug. Classify it
      // rather than letting it escape the cascade unhandled.
      const klass = deps.adapterFor(candidate.provider).classifyError(error);
      outcome = {
        kind: 'failed',
        errorClass: klass,
        message: error instanceof Error ? error.message : String(error),
        hasOutput: false,
        textSoFar: '',
        usage: emptyUsage(),
        costUsd: 0,
        ttftMs: undefined,
        httpStatus: undefined,
        retryAfterMs: undefined,
      };
    }
    attempts.push(toAttempt(index, candidate, outcome));
    totalCost += outcome.costUsd;

    switch (outcome.kind) {
      case 'success': {
        await relay({
          event: 'status',
          phase: 'completed',
          model: model.routerId,
          provider: candidate.provider,
        });
        if (messageId !== undefined) {
          await relay({ event: 'done', messageId, runId, stopReason: outcome.stopReason ?? 'end_turn' });
        }
        return successResult(candidate, outcome, totalCost, attempts);
      }

      case 'failed': {
        const errorClass = outcome.errorClass!;

        // Fatal classes stop the cascade: failover is a policy bypass here.
        if (!failsOver(errorClass)) {
          await relay({
            event: 'error',
            errorClass,
            message: outcome.message,
            attempts: summarize(attempts),
          });
          return {
            ok: false,
            totalCostUsd: totalCost,
            attempts,
            error: { class: errorClass, message: outcome.message },
          };
        }

        // Output already produced: this is a visible handoff, not a retry.
        if (outcome.hasOutput) {
          attempts[attempts.length - 1]!.status = 'switched';
          attempts[attempts.length - 1]!.message = `handoff after ${errorClass}`;
          await relay({
            event: 'status',
            phase: 'switched',
            model: model.routerId,
            provider: candidate.provider,
          });
          pendingContinuation = {
            partialText: outcome.textSoFar,
            from: { provider: candidate.provider, model: model.routerId },
          };
          if (index + 1 >= candidates.length) {
            await relay({
              event: 'error',
              errorClass,
              message: `the continuing model list is exhausted after a mid-stream ${errorClass}`,
              attempts: summarize(attempts),
            });
            return {
              ok: false,
              totalCostUsd: totalCost,
              attempts,
              error: { class: errorClass, message: outcome.message },
            };
          }
          continue;
        }

        // context_too_long with no output: compact, retry this candidate once.
        if (errorClass === 'context_too_long' && !usedCompactRetry) {
          runningRequest = compactRequest(runningRequest, model.contextWindow);
          usedCompactRetry = true;
          const retry = await attemptCandidate({
            adapter: deps.adapterFor(candidate.provider),
            apiKey: await deps.keyFor(candidate.provider),
            baseUrl: deps.baseUrlFor?.(candidate.provider),
            request: runningRequest,
            model,
            health,
            credentialId: candidate.credentialId,
            deps,
            relay,
          });
          attempts[attempts.length - 1] = toAttempt(index, candidate, retry);
          totalCost += retry.costUsd;
          outcome = retry;
          if (retry.kind === 'success') {
            await relay({
              event: 'status',
              phase: 'completed',
              model: model.routerId,
              provider: candidate.provider,
            });
            if (messageId !== undefined) {
              await relay({
                event: 'done',
                messageId,
                runId,
                stopReason: retry.stopReason ?? 'end_turn',
              });
            }
            return successResult(candidate, retry, totalCost, attempts);
          }
          // The compact retry also failed — fall through to normal failover.
        }

        // No output yet: silent failover. One status line, nothing more.
        if (index + 1 < candidates.length) {
          continue;
        }

        await relay({
          event: 'error',
          errorClass,
          message: outcome.message,
          attempts: summarize(attempts),
        });
        return {
          ok: false,
          totalCostUsd: totalCost,
          attempts,
          error: { class: errorClass, message: outcome.message },
        };
      }
    }
  }

  // Loop ended without a terminal return: every remaining candidate was
  // cooling-down or over budget.
  await relay({
    event: 'error',
    errorClass: 'unknown',
    message: 'no provider was available to serve this request',
    attempts: summarize(attempts),
  });
  return { ok: false, totalCostUsd: totalCost, attempts };
}

function successResult(
  candidate: { provider: Provider; model: ModelInfo },
  outcome: CandidateOutcome & { kind: 'success' },
  totalCost: number,
  attempts: AttemptRecord[],
): CascadeResult {
  return {
    ok: true,
    provider: candidate.provider,
    model: candidate.model.routerId,
    stopReason: outcome.stopReason,
    usage: outcome.usage,
    totalCostUsd: totalCost,
    attempts,
  };
}

function skippedAttempt(index: number, candidate: { provider: Provider; model: ModelInfo }, message: string): AttemptRecord {
  return {
    index,
    provider: candidate.provider,
    model: candidate.model.routerId,
    status: 'skipped',
    message,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
  };
}

// ── per-candidate execution ──────────────────────────────────────────────────

type Relay = (event: UnsequencedRouterEvent) => Promise<void>;

/** A `RouterEvent` without its `seq`; the cascade assigns seqs as frames leave. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type UnsequencedRouterEvent = DistributiveOmit<RouterEvent, 'seq'>;

interface AttemptParams {
  adapter: ProviderAdapter;
  apiKey: string;
  baseUrl?: string;
  request: ChatRequest;
  model: ModelInfo;
  health: HealthProbe;
  credentialId: string;
  deps: CascadeDeps;
  relay: Relay;
}

type CandidateOutcome =
  | {
      kind: 'success';
      stopReason?: string;
      usage: Usage;
      costUsd: number;
    }
  | {
      kind: 'failed';
      errorClass: ErrorClass;
      message: string;
      hasOutput: boolean;
      textSoFar: string;
      usage: Usage;
      costUsd: number;
      ttftMs?: number;
      httpStatus?: number;
      retryAfterMs?: number;
    };

async function attemptCandidate(params: AttemptParams): Promise<CandidateOutcome> {
  const { adapter, request, model, health, credentialId, deps, relay } = params;

  const startedAt = Date.now();
  let hasOutput = false;
  let textSoFar = '';
  let firstOutputAt: number | undefined;
  let usage: Usage = emptyUsage();
  let stopReason: string | undefined;

  const markFirstOutput = () => {
    if (!hasOutput) {
      hasOutput = true;
      firstOutputAt = Date.now();
    }
  };

  const pricing = deps.pricingFor(model);
  const config = {
    apiKey: params.apiKey,
    ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
    signal: deps.signal,
    connectTimeoutMs: 30_000,
  };

  try {
    for await (const event of adapter.stream(request, model.modelId, config)) {
      switch (event.type) {
        case 'start':
          break;

        case 'text_delta':
          markFirstOutput();
          textSoFar += event.text;
          await relay({ event: 'delta', text: event.text });
          break;

        case 'thinking_delta':
          markFirstOutput();
          if (deps.includeThinking && event.text) {
            await relay({ event: 'thinking', text: event.text });
          }
          break;

        case 'tool_call':
          markFirstOutput();
          await relay({
            event: 'tool',
            id: event.id,
            name: event.name,
            state: 'call',
            preview: JSON.stringify(event.input ?? {}).slice(0, 200),
          });
          break;

        case 'usage':
          usage = event.usage;
          break;

        case 'done':
          stopReason = event.stopReason;
          break;

        case 'error':
          throw new AdapterError({
            class: event.errorClass as ErrorClass,
            message: event.message,
            retryAfterMs: event.retryAfterMs,
          });
      }
    }

    const ttftMs = firstOutputAt !== undefined ? firstOutputAt - startedAt : undefined;
    const costUsd = pricing ? computeCostUsd(usage, pricing) : 0;

    await health.record(credentialId, { ok: true, ttftMs });

    return { kind: 'success', stopReason, usage, costUsd };
  } catch (error) {
    const adapterError =
      error instanceof AdapterError ? error : toAdapterError(error, model);
    const ttftMs =
      firstOutputAt !== undefined ? firstOutputAt - startedAt : undefined;
    const costUsd = pricing ? computeCostUsd(usage, pricing) : 0;

    await health.record(credentialId, {
      ok: false,
      errorClass: adapterError.class,
      ttftMs,
      retryAfterMs: adapterError.retryAfterMs,
    });

    return {
      kind: 'failed',
      errorClass: adapterError.class,
      message: adapterError.message,
      hasOutput,
      textSoFar,
      usage,
      costUsd,
      ttftMs,
      httpStatus: adapterError.httpStatus,
      retryAfterMs: adapterError.retryAfterMs,
    };
  }
}

function toAdapterError(error: unknown, model: ModelInfo): AdapterError {
  const status = (error as { status?: number })?.status;
  return new AdapterError({
    class: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    httpStatus: status,
    provider: model.provider,
    model: model.routerId,
    cause: error,
  });
}

function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function toAttempt(
  index: number,
  candidate: { provider: Provider; model: ModelInfo },
  outcome: CandidateOutcome,
): AttemptRecord {
  if (outcome.kind === 'success') {
    return {
      index,
      provider: candidate.provider,
      model: candidate.model.routerId,
      status: 'success',
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      cachedTokens: outcome.usage.cacheReadTokens,
      costUsd: outcome.costUsd,
    };
  }
  return {
    index,
    provider: candidate.provider,
    model: candidate.model.routerId,
    status: 'failed',
    errorClass: outcome.errorClass,
    httpStatus: outcome.httpStatus,
    message: outcome.message,
    ttftMs: outcome.ttftMs,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    cachedTokens: outcome.usage.cacheReadTokens,
    costUsd: outcome.costUsd,
  };
}

function summarize(attempts: AttemptRecord[]) {
  return attempts
    .filter(
      (a) => a.status === 'failed' || a.status === 'switched' || a.status === 'skipped',
    )
    .map((a) => ({
      provider: a.provider,
      model: a.model,
      errorClass: a.errorClass ?? a.status,
      message: a.message ?? a.status,
    }));
}
