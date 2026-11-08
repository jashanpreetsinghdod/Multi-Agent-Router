import { z } from 'zod';

/** Inline base64 image. Used for user-uploaded and generated images. */
export const Base64ImageSourceSchema = z.object({
  kind: z.literal('base64'),
  mediaType: z.string().min(1),
  data: z.string().min(1),
});

/** Remote image URL. Some providers require fetching and inlining these. */
export const UrlImageSourceSchema = z.object({
  kind: z.literal('url'),
  url: z.string().url(),
  mediaType: z.string().optional(),
});

export const ImageSourceSchema = z.discriminatedUnion('kind', [
  Base64ImageSourceSchema,
  UrlImageSourceSchema,
]);

export type ImageSource = z.infer<typeof ImageSourceSchema>;

export const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ImageBlockSchema = z.object({
  type: z.literal('image'),
  source: ImageSourceSchema,
  /** Optional alt text, carried through when a provider supports it. */
  alt: z.string().optional(),
});

export const ToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
});

export const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string().min(1),
  content: z.string(),
  isError: z.boolean().optional(),
});

export const BlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ImageBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
]);

export type Block = z.infer<typeof BlockSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;

/**
 * Roles are deliberately narrow. System prompts live on the request, not in
 * the message list, because every provider wants them somewhere different.
 *
 * `producedBy` marks which model generated an assistant turn. It is what lets
 * the failover path know it is continuing someone else's sentence, and it is
 * how provider-scoped reasoning blocks get stripped on a model switch.
 */
export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  blocks: z.array(BlockSchema).min(1),
  producedBy: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional(),
});

export type CanonicalMessage = z.infer<typeof MessageSchema>;
