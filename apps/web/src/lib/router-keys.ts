import { createHash, randomBytes } from 'node:crypto';
import { getStore } from './store';

const MAX_KEYS_PER_OWNER = 5;

const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');

export async function createRouterKey(owner: string): Promise<{ id: string; key: string } | { error: string }> {
  const store = getStore();
  if ((await store.countRouterKeys(owner)) >= MAX_KEYS_PER_OWNER) {
    return { error: `At most ${MAX_KEYS_PER_OWNER} router keys.` };
  }
  const key = `sk-router-${randomBytes(32).toString('base64url')}`;
  const id = await store.createRouterKey(owner, hashOf(key), key.slice(-4));
  await store.audit(owner, 'api_key.created', { id });
  return { id, key };
}

export async function ownerFromBearer(header: string | null): Promise<string | undefined> {
  const match = header?.match(/^Bearer\s+(sk-router-[A-Za-z0-9_-]{20,})$/);
  if (!match) return undefined;
  return getStore().ownerFromRouterKeyHash(hashOf(match[1]!));
}
