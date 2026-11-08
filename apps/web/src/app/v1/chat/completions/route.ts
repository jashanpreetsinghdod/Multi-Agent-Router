import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { CanonicalMessage, ChatRequest } from '@omnirouter/canonical';
import { parseSseChunk } from '@omnirouter/canonical';
import { streamChat } from '@/lib/router';
import { ownerFromBearer } from '@/lib/router-keys';
import { LIMITS, budgetFor, overBudget, rateLimit } from '@/lib/limits';
import { getStore } from '@/lib/store';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ContentSchema = z.union([
  z.string(),
  z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
  z.null(),
]);

const BodySchema = z.object({
  model: z.string().max(200).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
        content: ContentSchema.optional(),
      }).passthrough(),
    )
    .min(1)
    .max(1000),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
});

function oaiError(status: number, message: string, type = 'invalid_request_error') {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  const owner = await ownerFromBearer(req.headers.get('authorization'));
  if (!owner) {
    return oaiError(401, 'Missing or invalid router API key. Create one in OmniRouter Settings.', 'authentication_error');
  }
  const limited = rateLimit('api', owner, LIMITS.api);
  if (limited) {
    return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': limited.headers.get('Retry-After') ?? '60' },
    });
  }
  const budget = await budgetFor(owner);
  if (overBudget(budget)) {
    return oaiError(402, `Monthly spending limit of $${budget.capUsd!.toFixed(2)} reached.`, 'insufficient_quota');
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return oaiError(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
  }
  const body = parsed.data;

  let system: string | undefined;
  const messages: CanonicalMessage[] = [];
  for (const msg of body.messages) {
    const text =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => c.text ?? '').join('')
          : '';
    if (msg.role === 'system' || msg.role === 'developer') {
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }
    if (!text) continue;
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.blocks.push({ type: 'text', text });
    else messages.push({ role, blocks: [{ type: 'text', text }] });
  }
  if (messages.length === 0) return oaiError(400, 'messages must contain at least one user message');

  const maxOut = body.max_completion_tokens ?? body.max_tokens;
  const stop = typeof body.stop === 'string' ? [body.stop] : body.stop;
  const request: ChatRequest = {
    messages,
    stream: true,
    ...(system ? { system } : {}),
    ...(maxOut ? { maxOutputTokens: maxOut } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(stop?.length ? { stopSequences: stop } : {}),
  };

  const modelPolicy = body.model && body.model !== 'default' ? body.model : 'auto';
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const { stream, outcome } = streamChat({
    owner,
    request,
    modelPolicy,
    messageId: id,
    signal: req.signal,
    enableTools: false,
    ...(budget.remainingUsd !== undefined ? { budgetUsd: budget.remainingUsd } : {}),
  });

  void outcome
    .then((o) =>
      getStore().recordRuns(owner, {
        requestFingerprint: createHash('sha256').update(id).digest('hex'),
        ...(o.routedReason ? { routedReason: o.routedReason } : {}),
        attempts: o.allAttempts,
      }),
    )
    .catch(() => {});

  // ── Non-streaming ────────────────────────────────────────────────────────
  if (!body.stream) {
    // Drain the SSE stream so the cascade runs to completion.
    const reader = stream.getReader();
    while (!(await reader.read()).done) { }
    const o = await outcome;
    if (!o.ok) return oaiError(502, o.error?.message ?? 'All providers failed', 'api_error');
    return Response.json({
      id,
      object: 'chat.completion',
      created,
      model: o.model ?? modelPolicy,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: o.text },
          finish_reason: finishReason(o.stopReason),
        },
      ],
      usage: {
        prompt_tokens: o.totalUsage.inputTokens + o.totalUsage.cacheReadTokens,
        completion_tokens: o.totalUsage.outputTokens,
        total_tokens: o.totalUsage.inputTokens + o.totalUsage.cacheReadTokens + o.totalUsage.outputTokens,
      },
    });
  }

  // ── Streaming: translate RouterEvent frames into OpenAI chunks ───────────
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chunk = (model: string, delta: Record<string, unknown>, finish: string | null) =>
    encoder.encode(
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      let buffer = '';
      let model = modelPolicy;
      let sentRole = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunk(buffer);
          buffer = rest;
          for (const ev of events) {
            const data = JSON.parse(ev.data) as { model?: string; text?: string; message?: string };
            if ((ev.event === 'routed' || ev.event === 'status') && data.model) model = data.model;
            if (ev.event === 'delta' && data.text) {
              controller.enqueue(chunk(model, sentRole ? { content: data.text } : { role: 'assistant', content: data.text }, null));
              sentRole = true;
            }
            if (ev.event === 'error') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ error: { message: data.message ?? 'All providers failed', type: 'api_error' } })}\n\n`),
              );
            }
          }
        }
        const o = await outcome;
        if (o.ok) controller.enqueue(chunk(o.model ?? model, {}, finishReason(o.stopReason)));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch {
        // client disconnected
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(out, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function finishReason(stop: string | undefined): string {
  if (stop === 'max_tokens') return 'length';
  if (stop === 'tool_use') return 'tool_calls';
  if (stop === 'content_filter' || stop === 'refusal') return 'content_filter';
  return 'stop';
}
