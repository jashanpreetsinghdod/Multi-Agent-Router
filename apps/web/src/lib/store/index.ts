import type { NextRequest } from 'next/server';
import { memoryStore } from './memory';
import { createPostgresStore } from './postgres';
import type { Store } from './types';
import { sessionIdFrom } from '../session';

export type * from './types';

const g = globalThis as unknown as { __omniStore?: Store };

export function getStore(): Store {
  if (!g.__omniStore) {
    g.__omniStore = process.env.DATABASE_URL ? createPostgresStore() : memoryStore;
  }
  return g.__omniStore;
}

export async function ownerFrom(req: NextRequest): Promise<string | undefined> {
  const sid = sessionIdFrom(req);
  return sid ? getStore().resolveOwner(sid) : undefined;
}
