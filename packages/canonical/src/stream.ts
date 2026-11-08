import { z } from 'zod';
import { UsageSchema } from './response.js';
import { StopReasonSchema } from './response.js';

/**
 * The adapter's streaming vocabulary. Deliberately small and uniform across
 * providers so the router, the SSE relay, and the persistence layer all speak
 * one language.
 *
 * Invariants every adapter must uphold:
 *   1. Exactly one `start` is yielded before any delta.
 *   2. Exactly one `usage` is yielded before `done` (zeros allowed).
 *   3. `done` or a thrown AdapterError terminates the stream, never both.
 *   4. Tool-call arguments are buffered by the adapter and emitted complete in
 *      a single `tool_call` event — partial argument JSON is not exposed, since
 *      every downstream consumer would have to reimplement the same buffer.
 */
export const StatusEventSchema = z.object({
  type: z.literal('start'),
  provider: z.string(),
  model: z.string(),
});

export const TextDeltaEventSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

export const ThinkingDeltaEventSchema = z.object({
  type: z.literal('thinking_delta'),
  text: z.string(),
  /**
   * Provider-specific block that must round-trip verbatim on the same
   * conversation, and must be dropped on a model switch.
   */
  signature: z.string().optional(),
});

export const ToolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

export const UsageEventSchema = z.object({
  type: z.literal('usage'),
  usage: UsageSchema,
});

export const DoneEventSchema = z.object({
  type: z.literal('done'),
  stopReason: StopReasonSchema,
});

export const ErrorEventSchema = z.object({
  type: z.literal('error'),
  errorClass: z.string(),
  message: z.string(),
  retryAfterMs: z.number().optional(),
});

export const StreamEventSchema = z.discriminatedUnion('type', [
  StatusEventSchema,
  TextDeltaEventSchema,
  ThinkingDeltaEventSchema,
  ToolCallEventSchema,
  UsageEventSchema,
  DoneEventSchema,
  ErrorEventSchema,
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type StatusEvent = z.infer<typeof StatusEventSchema>;
export type TextDeltaEvent = z.infer<typeof TextDeltaEventSchema>;
export type ThinkingDeltaEvent = z.infer<typeof ThinkingDeltaEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
