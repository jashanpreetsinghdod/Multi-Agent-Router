import { NextRequest, NextResponse } from 'next/server';
import { isCatalogModel } from '@omnirouter/providers';
import { webSearchConfigured } from '@omnirouter/tools';
import { enabledRouterModels } from '@/lib/credentials';
import { ownerFrom } from '@/lib/store';
import { noSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();

  const byId = new Map<string, { routerId: string; provider: string; displayName: string; keys: number; known: boolean; tools: boolean; pricing: unknown; contextWindow: number }>();
  for (const m of await enabledRouterModels(owner)) {
    const existing = byId.get(m.routerId);
    if (existing) {
      existing.keys += 1;
      continue;
    }
    byId.set(m.routerId, {
      routerId: m.routerId,
      provider: m.provider,
      displayName: m.displayName,
      keys: 1,
      known: isCatalogModel(m.provider, m.modelId),
      tools: m.capabilities.tools,
      pricing: m.pricing,
      contextWindow: m.contextWindow,
    });
  }

  return NextResponse.json({
    models: [...byId.values()],
    webSearch: webSearchConfigured(),
  });
}
