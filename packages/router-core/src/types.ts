import type { Capabilities, ChatRequest, Provider } from '@omnirouter/canonical';
import type { ModelInfo } from '@omnirouter/providers';

/** A model the router is allowed to try, paired with the credential that serves it. */
export interface Candidate {
  model: ModelInfo;
  provider: Provider;
  credentialId: string;
  /** Set when scoring produced this candidate. Explains the ranking, not the selection. */
  score: number;
  /** Human-readable justification, surfaced in the `routed` SSE event. */
  reason: string;
}

export type HealthState = 'closed' | 'half_open' | 'open';

export interface CredentialHealth {
  state: HealthState;
  consecutiveFailures: number;
  /** Epoch ms. While in the future, the candidate is skipped. */
  cooldownUntil: number;
  /** Exponential moving average of success (0..1). Starts at 0.9. */
  successEma: number;
  /** Exponential moving average of time-to-first-token in ms. */
  ttftEmaMs: number;
}

export interface HealthProbe {
  get(credentialId: string): Promise<CredentialHealth | undefined>;
  /** Record an attempt outcome. Called once per attempt. */
  record(
    credentialId: string,
    outcome: {
      ok: boolean;
      retryAfterMs?: number;
      ttftMs?: number;
      errorClass?: string;
    },
  ): Promise<void>;
}

export interface RouterModel extends ModelInfo {
  /** Providers the user has at least one usable credential for. */
  enabledByUser: boolean;
}

export interface CandidateInput {
  request: ChatRequest;
  /** Every model the catalog knows and the user can actually reach. */
  models: RouterModel[];
  /** `auto`, `auto:cheap`, `auto:fast`, or a router id like `anthropic/claude-opus-5-5`. */
  modelPolicy: string;
  health: HealthProbe;
  /** Whitelist of provider ids from settings, if the user set one. */
  enabledProviders?: Provider[];
  /** Per-model quality prior, keyed by routerId. Defaults are supplied by the caller. */
  qualityPrior?: Record<string, number>;
  now?: number;
}

export interface RoutingDecision {
  /** Ordered by preference. The router tries them in order. */
  candidates: Candidate[];
  /** Why the list looks the way it does; empty when a single explicit model was requested. */
  rationale: string;
  /** True when the user pinned a model rather than using auto. */
  pinned: boolean;
  /** Populated when no candidate survived filtering. */
  failure?: {
    code: 'no_provider' | 'no_capability' | 'no_context' | 'all_cooling_down' | 'budget';
    message: string;
    suggestion?: string;
  };
}

export interface RoutingWeights {
  quality: number;
  cost: number;
  latency: number;
  reliability: number;
}

export const DEFAULT_WEIGHTS: RoutingWeights = {
  quality: 1.0,
  cost: 0.35,
  latency: 0.2,
  reliability: 0.3,
};

export interface CapabilityRequirement {
  vision?: boolean;
  pdf?: boolean;
  tools?: boolean;
  structuredOutput?: boolean;
  promptCaching?: boolean;
  reasoning?: boolean;
}

export function requiredCapabilities(
  request: ChatRequest,
  requested?: CapabilityRequirement,
): CapabilityRequirement {
  const features = {
    vision: request.messages.some((m) =>
      m.blocks.some((b) => b.type === 'image'),
    ),
    tools: (request.tools?.length ?? 0) > 0,
    structuredOutput: request.outputSchema !== undefined,
  };

  return {
    ...features,
    ...requested,
  };
}

export function supports(model: ModelInfo, need: CapabilityRequirement): boolean {
  const caps: Capabilities = model.capabilities;
  for (const key of Object.keys(need) as (keyof CapabilityRequirement)[]) {
    if (need[key] && !caps[key as keyof Capabilities]) return false;
  }
  return true;
}
