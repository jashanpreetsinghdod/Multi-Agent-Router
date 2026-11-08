import { z } from 'zod';
import { BlockSchema } from './messages.js';

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  providerReportedTotal: z.number().int().nonnegative().optional(),
});

export type Usage = z.infer<typeof UsageSchema>;

export const StopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'tool_use',
  'stop_sequence',
  'content_filter',
  'refusal',
  'error',
]);

export type StopReason = z.infer<typeof StopReasonSchema>;

export const ChatResponseSchema = z.object({
  blocks: z.array(BlockSchema),
  stopReason: StopReasonSchema,
  usage: UsageSchema,
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number().nonnegative().optional(),
  ttftMs: z.number().nonnegative().optional(),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;
