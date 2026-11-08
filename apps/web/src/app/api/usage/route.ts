import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { budgetFor } from '@/lib/limits';
import { getStore, ownerFrom } from '@/lib/store';
import { noSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({ capUsd: z.number().min(0).max(100_000).nullable() });

export async function GET(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const b = await budgetFor(owner);
  return NextResponse.json({ spentUsd: b.spentUsd, capUsd: b.capUsd });
}

export async function PATCH(req: NextRequest) {
  const owner = await ownerFrom(req);
  if (!owner) return noSession();
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'capUsd must be a number or null' }, { status: 400 });
  const store = getStore();
  await store.setMonthlyCap(owner, parsed.data.capUsd);
  await store.audit(owner, 'budget.updated', { capUsd: parsed.data.capUsd });
  const b = await budgetFor(owner);
  return NextResponse.json({ spentUsd: b.spentUsd, capUsd: b.capUsd });
}
