import { NextRequest, NextResponse } from 'next/server';
import { enabledRouterModels } from '@/lib/credentials';
import { ownerFromBearer } from '@/lib/router-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await ownerFromBearer(req.headers.get('authorization'));
  if (!owner) {
    return NextResponse.json(
      { error: { message: 'Missing or invalid router API key.', type: 'authentication_error' } },
      { status: 401 },
    );
  }

  const created = Math.floor(Date.now() / 1000);
  const virtual = ['auto', 'auto:cheap', 'auto:fast'].map((id) => ({
    id,
    object: 'model',
    created,
    owned_by: 'omnirouter',
  }));
  const seen = new Set<string>();
  const concrete = (await enabledRouterModels(owner))
    .filter((m) => !seen.has(m.routerId) && seen.add(m.routerId))
    .map((m) => ({ id: m.routerId, object: 'model', created, owned_by: m.provider }));

  return NextResponse.json({ object: 'list', data: [...virtual, ...concrete] });
}
