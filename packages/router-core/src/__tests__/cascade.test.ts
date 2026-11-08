import { describe, expect, it } from 'vitest';
import {
  type ChatRequest,
  type Provider,
  type RouterEvent,
} from '@omnirouter/canonical';
import type { ModelInfo, ProviderAdapter } from '@omnirouter/providers';
import { InMemoryHealthStore } from '../breaker.js';
import { runCascade, type CascadeDeps } from '../cascade.js';
import type { RoutingDecision } from '../types.js';
import { FakeAdapter } from './fake-adapter.js';

// ── harness ──────────────────────────────────────────────────────────────────

const anthropic = 'anthropic' as Provider;
const openai = 'openai' as Provider;
const google = 'google' as Provider;

function model(provider: Provider, suffix: string): ModelInfo {
  const id = suffix === 'large' ? 'fake-large' : 'fake-small';
  return {
    provider,
    modelId: id,
    routerId: `${provider}/${id}`,
    displayName: `Fake ${suffix} (${provider})`,
    // Deliberately small so the compaction tests can trigger turn-dropping.
    contextWindow: 12_000,
    maxOutputTokens: 8_192,
    capabilities: {
      vision: true,
      pdf: true,
      tools: true,
      structuredOutput: true,
      promptCaching: true,
      reasoning: true,
      streaming: true,
    },
    pricing: {
      inputPerMTok: suffix === 'large' ? 5 : 0.5,
      outputPerMTok: suffix === 'large' ? 25 : 2,
    },
    status: 'available',
  };
}

const DECISION: RoutingDecision = {
  candidates: [
    { model: model(anthropic, 'large'), provider: anthropic, credentialId: anthropic, score: 0, reason: 'test' },
    { model: model(openai, 'large'), provider: openai, credentialId: openai, score: 0, reason: 'test' },
    { model: model(google, 'large'), provider: google, credentialId: google, score: 0, reason: 'test' },
  ],
  rationale: 'test cascade',
  pinned: false,
};

const REQUEST: ChatRequest = {
  messages: [{ role: 'user', blocks: [{ type: 'text', text: 'hello world' }] }],
  stream: true,
};

type StatusShape = { event: 'status'; phase: string; model: string; provider: string };
type ErrorShape = { event: 'error'; errorClass: string; message: string; attempts?: unknown[] };

function harness(opts?: { decision?: RoutingDecision; request?: ChatRequest }) {
  const anthropicAdapter = new FakeAdapter(anthropic);
  const openaiAdapter = new FakeAdapter(openai);
  const googleAdapter = new FakeAdapter(google);

  const events: RouterEvent[] = [];
  const health = new InMemoryHealthStore({ baseCooldownMs: 1 });

  const adapters: Record<Provider, ProviderAdapter> = {
    anthropic: anthropicAdapter,
    openai: openaiAdapter,
    google: googleAdapter,
    compatible: anthropicAdapter,
  };

  const deps: CascadeDeps = {
    adapterFor: (p) => adapters[p]!,
    keyFor: async () => 'test-key',
    health,
    pricingFor: (m) => m.pricing,
    relay: async (event) => {
      events.push(event);
    },
  };

  const run = () =>
    runCascade(
      {
        request: opts?.request ?? REQUEST,
        decision: opts?.decision ?? DECISION,
        runId: 'run-test',
        messageId: 'msg-test',
      },
      deps,
    );

  const statuses = () => events.filter((e) => e.event === 'status') as StatusShape[];
  const error = () => events.find((e) => e.event === 'error') as unknown as ErrorShape | undefined;
  const deltas = () =>
    events.filter((e) => e.event === 'delta') as Array<{ event: 'delta'; text: string }>;

  return { anthropicAdapter, openaiAdapter, googleAdapter, events, run, deps, statuses, error, deltas };
}

// ── 1. happy path ────────────────────────────────────────────────────────────

describe('cascade: happy path', () => {
  it('succeeds on the first candidate and relays routed → delta → done', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', { kind: 'ok', text: 'hi there' });

    const result = await h.run();

    expect(result.ok).toBe(true);
    expect(result.provider).toBe(anthropic);
    expect(result.model).toBe('anthropic/fake-large');
    expect(result.stopReason).toBe('end_turn');
    expect(h.anthropicAdapter.requests).toHaveLength(1);
    expect(h.openaiAdapter.requests).toHaveLength(0);

    expect(h.events[0]).toMatchObject({ event: 'routed', provider: anthropic });
    expect(h.deltas().length).toBe(1);
    expect(h.deltas()[0]!.text).toBe('hi there');
    expect(h.statuses()[h.statuses().length - 1]).toMatchObject({ phase: 'completed' });
    expect(h.events[h.events.length - 1]).toMatchObject({ event: 'done' });
  });

  it('computes cost from the provider-reported usage and catalog price', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', { kind: 'ok', text: 'x'.repeat(40) });

    const result = await h.run();

    // $5/$25 per Mtok; 50 input + 10 output tokens.
    expect(result.totalCostUsd).toBeCloseTo((50 / 1e6) * 5 + (10 / 1e6) * 25, 6);
  });

  it('relays tool calls and stops the run on tool_use', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'ok',
      toolCall: { id: 'call_1', name: 'web_search', input: { query: 'x' } },
    });

    const result = await h.run();

    expect(result.stopReason).toBe('tool_use');
    const tool = h.events.find(
      (e) => e.event === 'tool',
    ) as { name: string; state: string } | undefined;
    expect(tool).toMatchObject({ name: 'web_search', state: 'call' });
  });
});

// ── 2. silent failover before first token ────────────────────────────────────

describe('cascade: silent failover before first output', () => {
  it('skips the failing candidate and succeeds on the next, with no "switched"', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_before_output',
      errorClass: 'rate_limit',
      retryAfterMs: 30_000,
    });
    h.openaiAdapter.queue('fake-large', { kind: 'ok', text: 'rescued' });

    const result = await h.run();

    expect(result.provider).toBe(openai);
    expect(h.error()).toBeUndefined();
    expect(h.statuses().some((s) => s.phase === 'switched')).toBe(false);
    expect(
      result.attempts.find((a) => a.provider === anthropic),
    ).toMatchObject({ status: 'failed', errorClass: 'rate_limit' });
  });

  it('re-checks health each candidate and skips a credential that is cooling down', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_before_output',
      errorClass: 'rate_limit',
      retryAfterMs: 60_000,
    });
    h.openaiAdapter.queue('fake-large', { kind: 'ok' });
    h.openaiAdapter.queue('fake-large', { kind: 'ok', text: 'still openai' });

    await h.run();
    const second = await h.run();

    expect(second.provider).toBe(openai);
    expect(second.attempts.find((a) => a.provider === anthropic)).toMatchObject({
      status: 'skipped',
    });
    expect(h.anthropicAdapter.requests).toHaveLength(1); // never re-invoked
  });

  it('cascades through two failures to the third candidate', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_before_output',
      errorClass: 'overloaded',
    });
    h.openaiAdapter.queue('fake-large', {
      kind: 'error_before_output',
      errorClass: 'quota',
    });
    h.googleAdapter.queue('fake-large', { kind: 'ok', text: 'third time' });

    const result = await h.run();

    expect(result.provider).toBe(google);
    expect(result.attempts.filter((a) => a.status === 'failed')).toHaveLength(2);
  });

  it('reports every attempt when all candidates fail', async () => {
    const h = harness();
    for (const a of [h.anthropicAdapter, h.openaiAdapter, h.googleAdapter]) {
      a.queue('fake-large', { kind: 'error_before_output', errorClass: 'rate_limit' });
    }

    const result = await h.run();

    expect(result.ok).toBe(false);
    expect(result.error?.class).toBe('rate_limit');
    expect(result.attempts).toHaveLength(3);
    expect(h.error()?.attempts?.length).toBe(3);
  });
});

// ── 3. mid-stream handoff after first token ──────────────────────────────────

describe('cascade: mid-stream handoff', () => {
  const longText = 'This answer should have been much longer and covered'.repeat(5);

  it('emits a visible "switched" status and completes on the next model', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_mid_stream',
      errorClass: 'timeout',
      charsBeforeDeath: 30,
      text: longText,
    });
    h.openaiAdapter.queue('fake-large', { kind: 'ok', text: ' — and finish here' });

    const result = await h.run();

    expect(result.provider).toBe(openai);
    expect(result.attempts.find((a) => a.status === 'switched')).toMatchObject({
      provider: anthropic,
    });
    expect(h.statuses().some((s) => s.phase === 'switched')).toBe(true);
    expect(h.statuses()[h.statuses().length - 1]).toMatchObject({ phase: 'completed' });
  });

  it('hands the partial reply to the next model as an assistant turn + instruction', async () => {
    const partial = 'partial answer text';
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_mid_stream',
      errorClass: 'timeout',
      charsBeforeDeath: partial.length,
      text: partial,
    });
    h.openaiAdapter.queue('fake-large', { kind: 'ok', text: '…' });

    await h.run();

    const seen = h.openaiAdapter.requests[0]!;
    const msgs = seen.request.messages;
    const assistant = msgs[msgs.length - 2]!;
    const user = msgs[msgs.length - 1]!;

    expect(assistant.role).toBe('assistant');
    expect(assistant.blocks[0]).toMatchObject({ type: 'text', text: partial });
    expect(assistant.producedBy).toMatchObject({ provider: anthropic });
    expect(user.role).toBe('user');
    expect((user.blocks[0] as { text: string }).text).toContain('Continue exactly where');
  });

  it('fails with an explanatory error when no further model can continue', async () => {
    const decision: RoutingDecision = { ...DECISION, candidates: DECISION.candidates.slice(0, 1) };
    const h = harness({ decision });
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_mid_stream',
      errorClass: 'overloaded',
      charsBeforeDeath: 20,
      text: 'xxxxxxxxxxxxxxxxxxxx',
    });

    const result = await h.run();

    expect(result.ok).toBe(false);
    expect(h.error()).toBeDefined();
    expect(result.attempts.some((a) => a.status === 'switched')).toBe(true);
  });
});

// ── 4. fatal errors stop the cascade ─────────────────────────────────────────

describe('cascade: fatal errors', () => {
  it('auth failure stops immediately and does not poison the breaker', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_before_output',
      errorClass: 'auth',
    });

    const result = await h.run();

    expect(result.attempts).toHaveLength(1);
    expect(h.error()?.errorClass).toBe('auth');
    expect(h.openaiAdapter.requests).toHaveLength(0);

    // auth is a credential problem, not a health event — breaker stays closed.
    const health = await h.deps.health.get(anthropic);
    expect(health?.state).toBe('closed');
  });

  it('refusal stops the cascade — no silent policy bypass', async () => {
    const h = harness();
    h.anthropicAdapter.queue('fake-large', {
      kind: 'error_before_output',
      errorClass: 'refusal',
    });

    const result = await h.run();
    expect(result.error?.class).toBe('refusal');
    expect(h.openaiAdapter.requests).toHaveLength(0);
    expect(h.googleAdapter.requests).toHaveLength(0);
  });
});

// ── 5. context_too_long recovery ─────────────────────────────────────────────

describe('cascade: context_too_long', () => {
  function longRequest(): ChatRequest {
    const chunks: ChatRequest['messages'] = [];
    for (let i = 0; i < 24; i++) {
      const blob = `turn ${i}: ` + 'lorem ipsum dolor sit amet '.repeat(80);
      chunks.push({ role: 'user', blocks: [{ type: 'text', text: blob }] });
      chunks.push({
        role: 'assistant',
        blocks: [{ type: 'text', text: 'reply ' + i + ': ' + 'consectetur adipiscing elit '.repeat(80) }],
      });
    }
    return { ...REQUEST, messages: chunks, stream: true };
  }

  it('compacts and retries the same candidate before cascading', async () => {
    const h = harness({ request: longRequest() });
    h.anthropicAdapter.queue('fake-large', { kind: 'context_too_long' });
    h.anthropicAdapter.queue('fake-large', { kind: 'ok', text: 'fitted now' });

    const result = await h.run();

    expect(result.provider).toBe(anthropic); // did not cascade
    expect(h.anthropicAdapter.requests).toHaveLength(2);
    expect(h.openaiAdapter.requests).toHaveLength(0);

    const [first, second] = h.anthropicAdapter.requests;
    expect(second.request.messages.length).toBeLessThan(first.request.messages.length);
  });

  it('cascades to another model if compaction does not fix it', async () => {
    const h = harness({ request: longRequest() });
    h.anthropicAdapter.queue('fake-large', { kind: 'context_too_long' });
    h.anthropicAdapter.queue('fake-large', { kind: 'context_too_long' });
    h.openaiAdapter.queue('fake-large', { kind: 'ok', text: 'fits elsewhere' });

    const result = await h.run();
    expect(result.provider).toBe(openai);
  });
});

// ── 6. circuit breaker state machine ─────────────────────────────────────────

describe('circuit breaker', () => {
  it('opens after the failure threshold and re-arms after cooldown', async () => {
    let clock = 1_000_000;
    const health = new InMemoryHealthStore({
      failureThreshold: 3,
      windowMs: 60_000,
      baseCooldownMs: 1000,
      maxCooldownMs: 5000,
      now: () => clock,
    });

    for (let i = 0; i < 3; i++) {
      await health.record('k', { ok: false, errorClass: 'rate_limit' });
    }
    expect((await health.get('k'))?.state).toBe('open');
    expect((await health.get('k'))?.cooldownUntil).toBeGreaterThan(clock);

    // Advance past the cooldown → half_open on next read.
    clock += 60_000;
    expect((await health.get('k'))?.state).toBe('half_open');

    // A success in half-open closes the breaker.
    await health.record('k', { ok: true });
    expect((await health.get('k'))?.state).toBe('closed');
  });

  it('honours a provider-supplied retry-after even for a single failure', async () => {
    let clock = 0;
    const health = new InMemoryHealthStore({
      failureThreshold: 3,
      windowMs: 60_000,
      baseCooldownMs: 5000,
      now: () => clock,
    });

    await health.record('k', { ok: false, errorClass: 'rate_limit', retryAfterMs: 120_000 });

    const probe = await health.get('k');
    expect(probe?.state).toBe('open');
    expect(probe?.cooldownUntil).toBe(120_000); // the provider's number wins
  });

  it('does not treat auth failures as health events', async () => {
    const health = new InMemoryHealthStore();
    await health.record('k', { ok: false, errorClass: 'auth' });
    expect((await health.get('k'))?.state).toBe('closed');
  });

  it('success decays the failure count and updates the latency EMA', async () => {
    const health = new InMemoryHealthStore({ alpha: 0.5 });
    await health.record('k', { ok: true, ttftMs: 1000 });
    await health.record('k', { ok: true, ttftMs: 4000 });
    const probe = await health.get('k');
    // success: 0.9 → 0.95 → 0.975 ; ttft (start 1200): 1100 → 2550
    expect(probe?.state).toBe('closed');
    expect(probe?.ttftEmaMs).toBeCloseTo(2550, 0);
    expect(probe?.successEma).toBeCloseTo(0.975, 3);
  });
});
