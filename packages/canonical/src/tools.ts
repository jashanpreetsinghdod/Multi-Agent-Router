import { z } from 'zod';

/**
 * A JSON Schema subset that every supported provider can represent without
 * lossy translation. Keep this conservative: anything richer has to be lowered
 * at the adapter boundary, and silent lowering is how tool calls break on
 * failover.
 */
export const JsonSchemaSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z
      .enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
      .optional(),
    description: z.string().optional(),
    properties: z.record(JsonSchemaSchema).optional(),
    items: JsonSchemaSchema.optional(),
    required: z.array(z.string()).optional(),
    enum: z.array(z.unknown()).optional(),
    additionalProperties: z.union([z.boolean(), JsonSchemaSchema]).optional(),
  }).catchall(z.unknown()),
) as unknown as z.ZodType<unknown>;

export type JsonSchema = Record<string, unknown>;

export const ToolDefSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string(),
  inputSchema: JsonSchemaSchema,
  /** Mark executed server-side by us, not by the model provider. */
  strict: z.boolean().optional(),
});

export type ToolDef = z.infer<typeof ToolDefSchema>;

export const ToolChoiceSchema = z.enum(['auto', 'none', 'required']);

export type ToolChoice = z.infer<typeof ToolChoiceSchema>;
