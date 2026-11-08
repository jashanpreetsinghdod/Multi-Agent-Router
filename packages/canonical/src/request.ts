import { z } from 'zod';
import { MessageSchema } from './messages.js';
import { ToolChoiceSchema, ToolDefSchema } from './tools.js';

/**
 * Hints that steer routing without changing the model's output. They are
 * advisory: the router may override a hint if honoring it would fail the
 * request, and every override is reported in `routed_to.reason`.
 */
export const RoutingHintsSchema = z.object({
  /** Upper bound on total request cost in USD. Candidates over this are filtered out. */
  maxCostUsd: z.number().nonnegative().optional(),
  /** Prefer low latency over raw quality. */
  preferSpeed: z.boolean().optional(),
  /** Require a specific capability set on top of what the content implies. */
  requireCapabilities: z
    .object({
      vision: z.boolean().optional(),
      tools: z.boolean().optional(),
      structuredOutput: z.boolean().optional(),
      reasoning: z.boolean().optional(),
    })
    .optional(),
  /** Restrict routing to these provider ids. */
  allowProviders: z.array(z.string()).optional(),
  /** Exclude these provider ids. */
  denyProviders: z.array(z.string()).optional(),
});

export type RoutingHints = z.infer<typeof RoutingHintsSchema>;

/**
 * The request the router reasons about, after translation from whichever wire
 * format arrived (native chat UI, Anthropic, OpenAI-compatible).
 */
export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  system: z.string().optional(),
  tools: z.array(ToolDefSchema).optional(),
  toolChoice: ToolChoiceSchema.optional(),
  /** JSON schema to constrain the final answer to. */
  outputSchema: z.record(z.unknown()).optional(),
  maxOutputTokens: z.number().int().positive().max(128_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stopSequences: z.array(z.string()).max(8).optional(),
  stream: z.boolean().default(true),
  hints: RoutingHintsSchema.optional(),
  /** Free-form metadata persisted with the run for debugging and analytics. */
  metadata: z.record(z.string()).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
