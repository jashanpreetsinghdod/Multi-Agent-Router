import type { CredentialHealth, HealthProbe } from './types.js';

/**
 * In-memory health store. Correct for a single process and for tests; the
 * production implementation (M3) is the same interface backed by Redis, with
 * Postgres as the durable mirror. Everything above this layer only knows the
 * `HealthProbe` interface, so swapping it is a one-line change in wiring.
 *
 * Breaker policy:
 *   closed    → normal. Any success resets the failure count.
 *   open      → after `failureThreshold` consecutive failures within
 *               `windowMs`. Skipped entirely until cooldown expires.
 *   half_open → one probe attempt allowed. Success closes the breaker;
 *               failure re-opens with a longer cooldown (capped).
 *
 * The cooldown honours `retry-after` when the provider supplies it, because
 * retrying before a provider's stated window is a guaranteed second failure
 * and, on some providers, counts against you.
 */
export interface BreakerOptions {
  failureThreshold: number;
  windowMs: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
  /** EMA smoothing factor for success rate and latency. */
  alpha: number;
  now?: () => number;
}

export const DEFAULT_BREAKER_OPTIONS: BreakerOptions = {
  failureThreshold: 3,
  windowMs: 60_000,
  baseCooldownMs: 30_000,
  maxCooldownMs: 15 * 60_000,
  alpha: 0.3,
};

interface BreakerEntry {
  state: CredentialHealth['state'];
  consecutiveFailures: number;
  firstFailureAt: number;
  cooldownUntil: number;
  successEma: number;
  ttftEmaMs: number;
  /** Number of times the breaker has opened without a success in between. */
  openCount: number;
}

export class InMemoryHealthStore implements HealthProbe {
  private readonly entries = new Map<string, BreakerEntry>();
  private readonly options: BreakerOptions;
  private readonly now: () => number;

  constructor(options: Partial<BreakerOptions> = {}) {
    this.options = { ...DEFAULT_BREAKER_OPTIONS, ...options };
    this.now = this.options.now ?? Date.now;
  }

  async get(credentialId: string): Promise<CredentialHealth | undefined> {
    const entry = this.entries.get(credentialId);
    if (!entry) return undefined;

    const now = this.now();

    // Lazy half-open transition: the state machine advances on read, so a
    // breaker that opens with no further traffic still recovers.
    if (entry.state === 'open' && entry.cooldownUntil <= now) {
      entry.state = 'half_open';
    }

    return {
      state: entry.state,
      consecutiveFailures: entry.consecutiveFailures,
      cooldownUntil: entry.cooldownUntil,
      successEma: entry.successEma,
      ttftEmaMs: entry.ttftEmaMs,
    };
  }

  async record(
    credentialId: string,
    outcome: {
      ok: boolean;
      retryAfterMs?: number;
      ttftMs?: number;
      errorClass?: string;
    },
  ): Promise<void> {
    const now = this.now();
    const entry = this.entries.get(credentialId) ?? this.fresh();
    const alpha = this.options.alpha;

    if (outcome.ok) {
      entry.state = 'closed';
      entry.consecutiveFailures = 0;
      entry.firstFailureAt = 0;
      entry.cooldownUntil = 0;
      entry.openCount = 0;
      entry.successEma = entry.successEma * (1 - alpha) + alpha;
      if (outcome.ttftMs !== undefined && outcome.ttftMs >= 0) {
        entry.ttftEmaMs = entry.ttftEmaMs * (1 - alpha) + outcome.ttftMs * alpha;
      }
      this.entries.set(credentialId, entry);
      return;
    }

    // Auth failures are not health events — the credential is wrong, and no
    // amount of cooldown fixes it. Mark it clearly but do not burn a breaker.
    if (outcome.errorClass === 'auth') {
      entry.successEma = Math.max(0, entry.successEma * (1 - alpha));
      this.entries.set(credentialId, entry);
      return;
    }

    entry.successEma = Math.max(0, entry.successEma * (1 - alpha));

    if (entry.firstFailureAt === 0 || now - entry.firstFailureAt > this.options.windowMs) {
      entry.firstFailureAt = now;
      entry.consecutiveFailures = 0;
    }
    entry.consecutiveFailures += 1;

    // A provider-supplied retry-after is authoritative: respect it even for a
    // single failure, since retrying early is a guaranteed repeat failure.
    const providerDelay = outcome.retryAfterMs;
    const shouldOpen =
      entry.consecutiveFailures >= this.options.failureThreshold ||
      (providerDelay !== undefined && providerDelay > 0) ||
      entry.state === 'half_open';

    if (shouldOpen) {
      entry.state = 'open';
      entry.openCount += 1;
      const backoff = Math.min(
        this.options.baseCooldownMs * 2 ** (entry.openCount - 1),
        this.options.maxCooldownMs,
      );
      entry.cooldownUntil = now + Math.max(providerDelay ?? 0, backoff);
    }

    this.entries.set(credentialId, entry);
  }

  /** Test helper: force a credential into a known state. */
  seed(credentialId: string, health: Partial<CredentialHealth>): void {
    const base = this.fresh();
    this.entries.set(credentialId, {
      ...base,
      ...health,
      firstFailureAt: health.state === 'open' ? this.now() : 0,
      openCount: health.state === 'open' ? 1 : 0,
    });
  }

  reset(): void {
    this.entries.clear();
  }

  private fresh(): BreakerEntry {
    return {
      state: 'closed',
      consecutiveFailures: 0,
      firstFailureAt: 0,
      cooldownUntil: 0,
      successEma: 0.9,
      ttftEmaMs: 1200,
      openCount: 0,
    };
  }
}
