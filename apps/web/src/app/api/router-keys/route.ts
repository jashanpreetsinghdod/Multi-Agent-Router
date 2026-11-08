import { NextRequest, NextResponse } from 'next/server';
import { createRouterKey } from '@/lib/router-keys';
import { getStore, ownerFrom } from '@/lib/store';
import { noSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  return NextResponse.json(await getStore().listRouterKeys(owner));
}

export async function POST(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const created = await createRouterKey(owner);
  if ('error' in created) return NextResponse.json(created, { status: 400 });
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const store = getStore();
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !(await store.revokeRouterKey(owner, id))) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  }
  await store.audit(owner, 'api_key.revoked', { id });
  return NextResponse.json({ ok: true });
}
