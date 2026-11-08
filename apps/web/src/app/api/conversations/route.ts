import { NextRequest, NextResponse } from 'next/server';
import { getStore, ownerFrom } from '@/lib/store';
import { noSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const store = getStore();

  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const conv = await store.getConversation(owner, id);
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    return NextResponse.json({
      id: conv.id,
      title: conv.title,
      modelPolicy: conv.modelPolicy,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''),
        provider: m.provider,
        model: m.modelId,
        switched: m.meta.switched,
        usage: m.meta.usage,
        error: m.meta.error,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  const list = await store.listConversations(owner);
  return NextResponse.json(
    list.map((c) => ({
      id: c.id,
      title: c.title,
      modelPolicy: c.modelPolicy,
      messageCount: c.messageCount,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  );
}

export async function DELETE(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (!(await getStore().deleteConversation(owner, id))) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
