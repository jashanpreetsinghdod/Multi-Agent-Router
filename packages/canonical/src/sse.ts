import { z } from 'zod';
import { UsageSchema } from './response.js';

const base = { seq: z.number().int().nonnegative() };

export const RoutedEventSchema = z.object({
  ...base,
  event: z.literal('routed'),
  runId: z.string(),
  model: z.string(),
  provider: z.string(),
  reason: z.string(),
  fallbacks: z.array(z.string()).max(5),
});

export const StatusEventSchema = z.object({
  ...base,
  event: z.literal('status'),
  phase: z.enum(['connecting', 'streaming', 'switched', 'completed']),
  model: z.string(),
  provider: z.string(),
});

export const DeltaEventSchema = z.object({
  ...base,
  event: z.literal('delta'),
  text: z.string(),
});

export const ThinkingEventSchema = z.object({
  ...base,
  event: z.literal('thinking'),
  text: z.string(),
});

export const ToolEventSchema = z.object({
  ...base,
  event: z.literal('tool'),
  id: z.string(),
  name: z.string(),
  state: z.enum(['call', 'result']),
  preview: z.string().optional(),
});

export const UsageEventSchema = z.object({
  ...base,
  event: z.literal('usage'),
  usage: UsageSchema,
  costUsd: z.number().nonnegative(),
});

export const DoneEventSchema = z.object({
  ...base,
  event: z.literal('done'),
  messageId: z.string(),
  runId: z.string(),
  stopReason: z.string(),
});

export const ErrorEventSchema = z.object({
  ...base,
  event: z.literal('error'),
  errorClass: z.string(),
  message: z.string(),
  attempts: z
    .array(
      z.object({
        provider: z.string(),
        model: z.string(),
        errorClass: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export const RouterEventSchema = z.discriminatedUnion('event', [
  RoutedEventSchema,
  StatusEventSchema,
  DeltaEventSchema,
  ThinkingEventSchema,
  ToolEventSchema,
  UsageEventSchema,
  DoneEventSchema,
  ErrorEventSchema,
]);

export type RouterEvent = z.infer<typeof RouterEventSchema>;

export function encodeSse(event: RouterEvent): string {
  return `id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseSseChunk(buffer: string): {
  events: Array<{ id?: string; event?: string; data: string }>;
  rest: string;
} {
  const events: Array<{ id?: string; event?: string; data: string }> = [];
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';

  for (const frame of frames) {
    if (!frame.trim()) continue;
    let id: string | undefined;
    let event: string | undefined;
    const dataLines: string[] = [];

    for (const line of frame.split('\n')) {
      if (line.startsWith('id: ')) id = line.slice(4);
      else if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      else if (line.startsWith(':')) continue; // comment / keepalive
    }

    if (dataLines.length > 0) {
      events.push({ id, event, data: dataLines.join('\n') });
    }
  }

  return { events, rest };
}
