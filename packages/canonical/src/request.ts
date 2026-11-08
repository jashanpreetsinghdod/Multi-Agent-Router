import { z } from 'zod';
import { MessageSchema } from './messages.js';
import { ToolChoiceSchema, ToolDefSchema } from './tools.js';

export const RoutingHintsSchema = z.object({
  maxCostUsd: z.number().nonnegative().optional(),
  preferSpeed: z.boolean().optional(),
  requireCapabilities: z
    .object({
      vision: z.boolean().optional(),
      tools: z.boolean().optional(),
      structuredOutput: z.boolean().optional(),
      reasoning: z.boolean().optional(),
    })
    .optional(),
  allowProviders: z.array(z.string()).optional(),
  denyProviders: z.array(z.string()).optional(),
});

export type RoutingHints = z.infer<typeof RoutingHintsSchema>;

export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  system: z.string().optional(),
  tools: z.array(ToolDefSchema).optional(),
  toolChoice: ToolChoiceSchema.optional(),
  outputSchema: z.record(z.unknown()).optional(),
  maxOutputTokens: z.number().int().positive().max(128_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stopSequences: z.array(z.string()).max(8).optional(),
  stream: z.boolean().default(true),
  hints: RoutingHintsSchema.optional(),
  metadata: z.record(z.string()).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
