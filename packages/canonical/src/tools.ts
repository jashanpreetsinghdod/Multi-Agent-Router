import { z } from 'zod';

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
  strict: z.boolean().optional(),
});

export type ToolDef = z.infer<typeof ToolDefSchema>;

export const ToolChoiceSchema = z.enum(['auto', 'none', 'required']);

export type ToolChoice = z.infer<typeof ToolChoiceSchema>;
