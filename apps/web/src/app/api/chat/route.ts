import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { CanonicalMessage, ChatRequest } from '@omnirouter/canonical';
import { streamChat } from '@/lib/router';
import { getStore, ownerFrom } from '@/lib/store';
import { noSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ChatBodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(200_000),
  modelPolicy: z.string().trim().min(1).max(160).optional(),
  system: z.string().max(20_000).optional(),
  tools: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const store = getStore();

  const parsed = ChatBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
  }
  const body = parsed.data;

  const existing = body.conversationId ? await store.getConversation(owner, body.conversationId) : undefined;
  const conv =
    existing ??
    {
      ...(await store.createConversation(owner, {
        modelPolicy: body.modelPolicy ?? 'auto',
        ...(body.system ? { systemPrompt: body.system } : {}),
      })),
      messages: [],
    };
  const modelPolicy = body.modelPolicy ?? conv.modelPolicy ?? 'auto';

  const userMessageId = crypto.randomUUID();
  await store.addMessage(owner, conv.id, {
    id: userMessageId,
    role: 'user',
    blocks: [{ type: 'text', text: body.message }],
    isPartial: false,
    meta: {},
  });
  await store.updateConversation(owner, conv.id, {
    modelPolicy,
    ...(conv.title ? {} : { title: titleFrom(body.message) }),
  });

  const history: CanonicalMessage[] = [
    ...conv.messages,
    { role: 'user' as const, blocks: [{ type: 'text' as const, text: body.message }] },
  ]
    .filter((m) => m.role === 'user' || m.blocks.some((b) => b.type === 'text' && b.text.trim()))
    .map((m) => ({
      role: m.role,
      blocks: m.blocks,
      ...('provider' in m && m.role === 'assistant' && m.provider && m.modelId
        ? { producedBy: { provider: m.provider, model: m.modelId } }
        : {}),
    }));

  const systemPrompt = body.system ?? conv.systemPrompt ?? undefined;
  const request: ChatRequest = {
    messages: mergeConsecutive(history),
    ...(systemPrompt ? { system: systemPrompt } : {}),
    stream: true,
  };

  const assistantMessageId = crypto.randomUUID();
  const { stream, outcome } = streamChat({
    owner,
    request,
    modelPolicy,
    messageId: assistantMessageId,
    signal: req.signal,
    enableTools: body.tools ?? true,
  });

  void outcome
    .then(async (o) => {
      await store.addMessage(owner, conv.id, {
        id: assistantMessageId,
        role: 'assistant',
        blocks: [{ type: 'text', text: o.text }],
        ...(o.provider ? { provider: o.provider } : {}),
        ...(o.model ? { modelId: o.model } : {}),
        runId: o.runId,
        isPartial: !o.ok,
        meta: {
          ...(o.switched ? { switched: true } : {}),
          usage: {
            inputTokens: o.totalUsage.inputTokens,
            outputTokens: o.totalUsage.outputTokens,
            costUsd: o.totalCostUsd,
          },
          ...(o.error ? { error: { errorClass: o.error.class, message: o.error.message } } : {}),
        },
      });
      await store.recordRuns(owner, {
        conversationId: conv.id,
        messageId: assistantMessageId,
        requestFingerprint: createHash('sha256').update(`${conv.id}:${userMessageId}`).digest('hex'),
        ...(o.routedReason ? { routedReason: o.routedReason } : {}),
        attempts: o.allAttempts,
      });
    })
    .catch((err) => {
      // Never log message content or keys; the error class is enough.
      console.error('[chat] failed to persist reply:', err instanceof Error ? err.message : 'unknown');
    });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Conversation-Id': conv.id,
    },
  });
}

function titleFrom(message: string): string {
  const text = message.replace(/\s+/g, ' ').trim();
  return text.slice(0, 80) + (text.length > 80 ? '…' : '');
}

function mergeConsecutive(messages: CanonicalMessage[]): CanonicalMessage[] {
  const out: CanonicalMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      out[out.length - 1] = { ...last, blocks: [...last.blocks, ...m.blocks] };
    } else {
      out.push(m);
    }
  }
  return out;
}
