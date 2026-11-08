import type { NextRequest } from 'next/server';
import { memoryStore } from './memory';
import { createPostgresStore } from './postgres';
import type { Store } from './types';
import { sessionIdFrom } from '../session';
import { signedInUser } from '../auth';

export type * from './types';

const g = globalThis as unknown as { __omniStore?: Store };

export function getStore(): Store {
  if (!g.__omniStore) {
    g.__omniStore = process.env.DATABASE_URL ? createPostgresStore() : memoryStore;
  }
  return g.__omniStore;
}

export async function ownerInfo(req: NextRequest): Promise<{ owner: string; signedIn: boolean } | undefined> {
  const user = await signedInUser(req.headers);
  if (user) return { owner: user.id, signedIn: true };
  const sid = sessionIdFrom(req);
  return sid ? { owner: await getStore().resolveOwner(sid), signedIn: false } : undefined;
}

/** Signed-in user's id if there is one, otherwise this browser's guest id. */
export async function ownerFrom(req: NextRequest): Promise<string | undefined> {
  return (await ownerInfo(req))?.owner;
}
