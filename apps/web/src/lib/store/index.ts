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

/** Signed-in user's id if there is one, otherwise this browser's guest id. */
export async function ownerFrom(req: NextRequest): Promise<string | undefined> {
  const user = await signedInUser(req.headers);
  if (user) return user.id;
  const sid = sessionIdFrom(req);
  return sid ? getStore().resolveOwner(sid) : undefined;
}
