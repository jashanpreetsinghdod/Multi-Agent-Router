import { z } from 'zod';

/**
 * What a model can do. The router filters candidates against the features a
 * request actually needs, so these flags are load-bearing: a wrong `vision`
 * flag means the request either fails at the provider or gets silently mangled.
 */
export const CapabilitiesSchema = z.object({
  vision: z.boolean(),
  pdf: z.boolean(),
  tools: z.boolean(),
  /** Provider supports a schema-constrained response (JSON mode / structured output). */
  structuredOutput: z.boolean(),
  /** Provider exposes prompt caching the router can pass through. */
  promptCaching: z.boolean(),
  /** Provider exposes an extended-thinking / reasoning control. */
  reasoning: z.boolean(),
  streaming: z.boolean(),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const DEFAULT_CAPABILITIES: Capabilities = {
  vision: false,
  pdf: false,
  tools: false,
  structuredOutput: false,
  promptCaching: false,
  reasoning: false,
  streaming: true,
};
