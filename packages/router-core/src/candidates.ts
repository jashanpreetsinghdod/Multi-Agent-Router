import {
  extractTaskFeatures,
  estimateRequestTokens,
} from '@omnirouter/canonical';
import {
  DEFAULT_CAPABILITIES,
  type ChatRequest,
  type Provider,
} from '@omnirouter/canonical';
import type { ModelInfo } from '@omnirouter/providers';
import type {
  Candidate,
  CandidateInput,
  CredentialHealth,
  RoutingDecision,
  RoutingWeights,
} from './types.js';
import { DEFAULT_WEIGHTS, requiredCapabilities, supports } from './types.js';
import { describeChoice, scoreCandidate, taskFamily } from './score.js';

const NEUTRAL_HEALTH: CredentialHealth = {
  state: 'closed',
  consecutiveFailures: 0,
  cooldownUntil: 0,
  successEma: 0.9,
  ttftEmaMs: 1200,
};

export async function buildDecision(input: CandidateInput): Promise<RoutingDecision> {
  const now = input.now ?? Date.now();
  const { request, models, modelPolicy, health } = input;
  const weights: RoutingWeights = input.weights ?? DEFAULT_WEIGHTS;

  const pinnedModel = parsePinnedModel(modelPolicy);
  const pinned = pinnedModel !== undefined;

  const allowedProviders = new Set<Provider>(
    (input.enabledProviders ?? []).filter(Boolean),
  );
  const hints = request.hints;
  const denied = new Set(hints?.denyProviders ?? []);
  const allowOnly = new Set(hints?.allowProviders ?? []);

  const need = requiredCapabilities(request, hints?.requireCapabilities);
  const estimatedInput = estimateRequestTokens(request);

  // ── 1. Hard filters ──────────────────────────────────────────────────────
  const reachable = models.filter((m) => m.status === 'available' && m.enabledByUser);

  if (reachable.length === 0) {
    return {
      candidates: [],
      rationale: '',
      pinned,
      failure: {
        code: 'no_provider',
        message: 'No provider keys are configured yet.',
        suggestion: 'Add an API key for at least one provider to start chatting.',
      },
    };
  }

  const providerFiltered = reachable.filter((m) => {
    if (allowedProviders.size > 0 && !allowedProviders.has(m.provider)) return false;
    if (denied.has(m.provider)) return false;
    if (allowOnly.size > 0 && !allowOnly.has(m.provider)) return false;
    return true;
  });

  const capable = providerFiltered.filter((m) => supports(m, need));

  if (capable.length === 0) {
    const missing = Object.entries(need)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return {
      candidates: [],
      rationale: '',
      pinned,
      failure: {
        code: 'no_capability',
        message: `No enabled model supports this request (${missing.join(', ')}).`,
        suggestion: `Enable a model with ${missing.join(' + ')} support, such as GPT-4.1, Gemini 2.5 Pro, or Claude Opus 5.5.`,
      },
    };
  }

  const fits = capable.filter((m) => m.contextWindow >= estimatedInput + 1024);
  if (fits.length === 0) {
    return {
      candidates: [],
      rationale: '',
      pinned,
      failure: {
        code: 'no_context',
        message: `This conversation (~${estimatedInput.toLocaleString()} tokens) is larger than every enabled model's context window.`,
        suggestion: 'Start a new conversation, or enable a model with a 1M-token context window.',
      },
    };
  }

  // ── 2. Health ────────────────────────────────────────────────────────────
  const healthByCredential = new Map<string, CredentialHealth>();
  const credIds = [...new Set(fits.map(healthKeyOf))];
  await Promise.all(
    credIds.map(async (id) => {
      const h = (await health.get(id)) ?? { ...NEUTRAL_HEALTH };
      healthByCredential.set(id, h);
    }),
  );

  const healthy = fits.filter((m) => {
    const h = healthByCredential.get(healthKeyOf(m));
    return !h || h.cooldownUntil <= now;
  });

  if (healthy.length === 0) {
    return {
      candidates: [],
      rationale: '',
      pinned,
      failure: {
        code: 'all_cooling_down',
        message: 'Every enabled provider is currently rate-limited.',
        suggestion: 'Retrying shortly usually works. Adding a second provider key makes this much rarer.',
      },
    };
  }

  // ── 3. Pin vs. score ─────────────────────────────────────────────────────
  if (pinned) {
    const exact = healthy.filter((m) => m.routerId === pinnedModel || m.modelId === pinnedModel);
    const ordered = [
      ...exact,
      ...rank(healthy.filter((m) => !exact.includes(m)), request, healthByCredential, weights, input.qualityPrior),
    ].slice(0, 3);

    return {
      candidates: ordered.map((m, index) => toCandidate(m, healthByCredential, request, index, input.qualityPrior)),
      rationale: exact.length
        ? `Pinned to ${exact[0]!.displayName}${ordered.length > 1 ? ` · ${ordered.length - 1} fallback${ordered.length > 2 ? 's' : ''} ready` : ''}`
        : `${pinnedModel} is unavailable; using the best available model instead`,
      pinned: true,
    };
  }

  const ranked = rank(healthy, request, healthByCredential, weights, input.qualityPrior);
  const selected = ranked.slice(0, maxAttempts(modelPolicy));

  const family = taskFamily(request);
  const top = selected[0]!;
  const topHealth = healthByCredential.get(healthKeyOf(top)) ?? NEUTRAL_HEALTH;
  const topQuality = qualityOf(top, input.qualityPrior);

  return {
    candidates: selected.map((m, index) =>
      toCandidate(m, healthByCredential, request, index, input.qualityPrior),
    ),
    rationale: `Auto → ${top.displayName}: ${describeChoice(top, topQuality, family, topHealth)}`,
    pinned: false,
  };
}

function toCandidate(
  model: ModelInfo,
  healthByCredential: Map<string, CredentialHealth>,
  request: ChatRequest,
  _index: number,
  prior: Record<string, number> | undefined,
): Candidate {
  const h = healthByCredential.get(healthKeyOf(model)) ?? NEUTRAL_HEALTH;
  return {
    model,
    provider: model.provider,
    credentialId: credentialOf(model),
    healthKey: healthKeyOf(model),
    score: scoreCandidate({
      model,
      request,
      health: h,
      quality: qualityOf(model, prior),
      weights: DEFAULT_WEIGHTS,
      maxCost: 1,
      maxTtft: 3000,
    }),
    reason: describeChoice(model, qualityOf(model, prior), taskFamily(request), h),
  };
}

function rank(
  models: ModelInfo[],
  request: ChatRequest,
  healthByCredential: Map<string, CredentialHealth>,
  weights: RoutingWeights,
  prior: Record<string, number> | undefined,
): ModelInfo[] {
  const features = extractTaskFeatures(request);
  const family = taskFamily(request);
  const hint = request.hints;

  const scores = models.map((model) => {
    const h = healthByCredential.get(healthKeyOf(model)) ?? NEUTRAL_HEALTH;
    const quality = qualityOf(model, prior, family);
    return {
      model,
      quality,
      score: scoreCandidate({
        model,
        request,
        health: h,
        quality,
        weights,
        maxCost: 1,
        maxTtft: 3000,
      }),
    };
  });

  if (hint?.preferSpeed) {
    for (const entry of scores) {
      const h = healthByCredential.get(healthKeyOf(entry.model)) ?? NEUTRAL_HEALTH;
      entry.score -= (h.ttftEmaMs / 3000) * 0.8;
    }
  }

  if (features.longContext) {
    for (const entry of scores) {
      if (entry.model.contextWindow >= 500_000) entry.score += 0.05;
    }
  }

  return scores
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.model);
}

export function qualityOf(
  model: ModelInfo,
  prior: Record<string, number> | undefined,
  family?: string,
): number {
  const map = prior ?? {};
  return (
    map[model.routerId] ??
    map[model.modelId] ??
    (family ? prior?.[family] : undefined) ??
    map['general'] ??
    0.5
  );
}

// Rate limits are mostly per model per key, so a 429 cools only that model.
function healthKeyOf(model: ModelInfo & { credentialId?: string }): string {
  return model.credentialId ? `${model.credentialId}:${model.modelId}` : model.provider;
}

function credentialOf(model: ModelInfo & { credentialId?: string }): string {
  return model.credentialId ?? model.provider;
}

function parsePinnedModel(policy: string): string | undefined {
  if (!policy || policy === 'auto' || policy.startsWith('auto:')) return undefined;
  return policy;
}

function maxAttempts(policy: string): number {
  if (policy === 'auto:cheap' || policy === 'auto:fast') return 2;
  return 3;
}

export function fallbackCapabilities(): typeof DEFAULT_CAPABILITIES {
  return DEFAULT_CAPABILITIES;
}
