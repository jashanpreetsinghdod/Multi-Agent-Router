import { NextResponse, type NextRequest } from 'next/server';
import { signedInUser } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { sessionIdFrom } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Google redirects here after sign-in: move this browser's guest data into the account.
export async function GET(req: NextRequest) {
  const home = new URL('/', req.url);
  const user = await signedInUser(req.headers);
  const sid = sessionIdFrom(req);
  if (!user || !sid) return NextResponse.redirect(home);

  const store = getStore();
  const guest = await store.findGuestOwner(sid);
  if (guest && guest !== user.id) {
    const moved = await store.mergeOwners(guest, user.id);
    await store.audit(user.id, 'account.guest_merged', moved);
    if (moved.credentials || moved.conversations) {
      home.searchParams.set('merged', `${moved.credentials},${moved.conversations}`);
    }
  }
  return NextResponse.redirect(home);
}
