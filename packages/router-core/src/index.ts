export type {
  Candidate,
  CredentialHealth,
  HealthProbe,
  HealthState,
  CandidateInput,
  RouterModel,
  RoutingDecision,
  RoutingWeights,
  CapabilityRequirement,
} from './types.js';
export { DEFAULT_WEIGHTS, requiredCapabilities, supports } from './types.js';

export { buildDecision, qualityOf } from './candidates.js';

export {
  InMemoryHealthStore,
  DEFAULT_BREAKER_OPTIONS,
  type BreakerOptions,
} from './breaker.js';

export {
  runCascade,
  type CascadeDeps,
  type CascadeRequest,
  type CascadeResult,
  type AttemptRecord,
} from './cascade.js';

export {
  buildContinuationRequest,
  compactRequest,
  dropOldestTurn,
  CONTINUATION_INSTRUCTION,
  type Continuation,
} from './compaction.js';

export {
  scoreCandidate,
  taskFamily,
  describeChoice,
  estimatedUsage,
  type ScoreInput,
} from './score.js';
