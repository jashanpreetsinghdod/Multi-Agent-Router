import type { Capabilities, ChatRequest, Provider } from '@omnirouter/canonical';
import type { ModelInfo } from '@omnirouter/providers';

export interface Candidate {
  model: ModelInfo;
  provider: Provider;
  credentialId: string;
  score: number;
  reason: string;
}

export type HealthState = 'closed' | 'half_open' | 'open';

export interface CredentialHealth {
  state: HealthState;
  consecutiveFailures: number;
  cooldownUntil: number;
  successEma: number;
  ttftEmaMs: number;
}

export interface HealthProbe {
  get(credentialId: string): Promise<CredentialHealth | undefined>;
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
  enabledByUser: boolean;
  credentialId?: string;
}

export interface CandidateInput {
  request: ChatRequest;
  models: RouterModel[];
  modelPolicy: string;
  health: HealthProbe;
  enabledProviders?: Provider[];
  qualityPrior?: Record<string, number>;
  weights?: RoutingWeights;
  now?: number;
}

export interface RoutingDecision {
  candidates: Candidate[];
  rationale: string;
  pinned: boolean;
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
