import { z } from 'zod';

export const CapabilitiesSchema = z.object({
  vision: z.boolean(),
  pdf: z.boolean(),
  tools: z.boolean(),
  structuredOutput: z.boolean(),
  promptCaching: z.boolean(),
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
