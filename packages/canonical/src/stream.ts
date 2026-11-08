import { z } from 'zod';
import { UsageSchema } from './response.js';
import { StopReasonSchema } from './response.js';

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
  signature: z.string().optional(),
});

export const ToolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
  signature: z.string().optional(),
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
