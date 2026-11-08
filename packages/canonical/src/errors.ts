import { z } from 'zod';

/**
 * The only error taxonomy the router branches on.
 *
 *   rate_limit      → provider is throttling. Cooldown, then fail over.
 *   quota           → hard account limit / out of credit. Disable, fail over.
 *   auth            → key is wrong or revoked. Never retry, never fail over silently.
 *   overloaded      → upstream 5xx / capacity. One retry, then fail over.
 *   timeout         → no response in time. One retry, then fail over.
 *   context_too_long→ request does not fit. Compact and retry same candidate.
 *   invalid_request → we built a bad request. Bug: fail over, and log loudly.
 *   refusal         → model declined. Not an error to retry on another model
 *                     without the user asking — that is a policy bypass.
 *   content_filter  → provider-side filter tripped.
 *   unknown         → treat as overloaded, but mark the run for triage.
 */
export const ErrorClassSchema = z.enum([
  'rate_limit',
  'quota',
  'auth',
  'overloaded',
  'timeout',
  'context_too_long',
  'invalid_request',
  'refusal',
  'content_filter',
  'unknown',
]);

export type ErrorClass = z.infer<typeof ErrorClassSchema>;

export interface AdapterErrorInit {
  class: ErrorClass;
  message: string;
  httpStatus?: number;
  provider?: string;
  model?: string;
  /** Milliseconds the caller should wait before retrying, from headers when present. */
  retryAfterMs?: number;
  /** Raw provider payload, stored only when scrubbed. */
  cause?: unknown;
}

/**
 * Every adapter must throw or yield this type. Anything else that escapes an
 * adapter is a bug, and the router treats it as `unknown`.
 */
export class AdapterError extends Error {
  readonly class: ErrorClass;
  readonly httpStatus?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly retryAfterMs?: number;

  constructor(init: AdapterErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'AdapterError';
    this.class = init.class;
    this.httpStatus = init.httpStatus;
    this.provider = init.provider;
    this.model = init.model;
    this.retryAfterMs = init.retryAfterMs;
  }

  toJSON() {
    return {
      name: this.name,
      class: this.class,
      message: this.message,
      httpStatus: this.httpStatus,
      provider: this.provider,
      model: this.model,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/** Worth one more attempt on the same candidate. */
const RETRYABLE_ON_SAME_CANDIDATE: ReadonlySet<ErrorClass> = new Set([
  'overloaded',
  'timeout',
  'unknown',
]);

/** Worth trying a different candidate. `auth` is excluded deliberately. */
const FAILS_OVER: ReadonlySet<ErrorClass> = new Set([
  'rate_limit',
  'quota',
  'overloaded',
  'timeout',
  'context_too_long',
  'invalid_request',
  'unknown',
]);

/** Stops the cascade. Surfacing a policy or credential problem is the right move. */
const FATAL: ReadonlySet<ErrorClass> = new Set(['auth', 'refusal']);

export function isRetryable(errorClass: ErrorClass): boolean {
  return RETRYABLE_ON_SAME_CANDIDATE.has(errorClass);
}

export function isFatal(errorClass: ErrorClass): boolean {
  return FATAL.has(errorClass);
}

export function failsOver(errorClass: ErrorClass): boolean {
  return FAILS_OVER.has(errorClass);
}
