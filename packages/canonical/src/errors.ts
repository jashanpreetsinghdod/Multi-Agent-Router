import { z } from 'zod';

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
  retryAfterMs?: number;
  cause?: unknown;
}

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

const RETRYABLE_ON_SAME_CANDIDATE: ReadonlySet<ErrorClass> = new Set([
  'overloaded',
  'timeout',
  'unknown',
]);

const FAILS_OVER: ReadonlySet<ErrorClass> = new Set([
  'rate_limit',
  'quota',
  'overloaded',
  'timeout',
  'context_too_long',
  'invalid_request',
  'unknown',
]);

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
