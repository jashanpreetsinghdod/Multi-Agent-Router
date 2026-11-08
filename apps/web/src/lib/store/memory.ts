import { createHash, randomUUID } from 'node:crypto';
import type {
  ConversationRecord,
  ConversationSummary,
  ConversationWithMessages,
  CredentialRecord,
  MessageRecord,
  Store,
} from './types';

interface MemState {
  credentials: Map<string, Map<string, CredentialRecord>>;
  secrets: Map<string, string>; // credential id -> plaintext key
  conversations: Map<string, ConversationWithMessages & { owner: string }>;
  routerKeys: Map<string, { id: string; owner: string; last4: string; createdAt: Date }>; // by hash
}

const MAX_CONVERSATIONS = 200;

const g = globalThis as unknown as { __omniMemStore?: MemState };
const state: MemState = (g.__omniMemStore ??= {
  credentials: new Map(),
  secrets: new Map(),
  conversations: new Map(),
  routerKeys: new Map(),
});

function bucket(owner: string): Map<string, CredentialRecord> {
  let b = state.credentials.get(owner);
  if (!b) state.credentials.set(owner, (b = new Map()));
  return b;
}

const clone = <T>(v: T): T => structuredClone(v);

function ownConversation(owner: string, id: string) {
  const c = state.conversations.get(id);
  return c && c.owner === owner ? c : undefined;
}

function summary(c: ConversationWithMessages & { owner: string }): ConversationSummary {
  const { messages, owner: _owner, ...rest } = c;
  return { ...rest, messageCount: messages.length };
}

export const memoryStore: Store = {
  kind: 'memory',

  async resolveOwner(sessionId) {
    return sessionId;
  },
  async findGuestOwner(sessionId) {
    return sessionId;
  },
  // Sign-in needs a database, so there is never anything to merge in memory mode.
  async mergeOwners() {
    return { credentials: 0, conversations: 0 };
  },

  async listCredentials(owner) {
    return [...(state.credentials.get(owner)?.values() ?? [])].map(clone);
  },
  async getCredential(owner, id) {
    const c = state.credentials.get(owner)?.get(id);
    return c ? clone(c) : undefined;
  },
  async hasFingerprint(owner, fingerprint) {
    return [...(state.credentials.get(owner)?.values() ?? [])].some((c) => c.fingerprint === fingerprint);
  },
  async addCredential(owner, input) {
    const { apiKey, ...rest } = input;
    const record: CredentialRecord = {
      ...rest,
      id: randomUUID(),
      keyLast4: apiKey.slice(-4),
      fingerprint: createHash('sha256').update(apiKey).digest('hex'),
      createdAt: new Date(),
    };
    bucket(owner).set(record.id, record);
    state.secrets.set(record.id, apiKey);
    return clone(record);
  },
  async updateCredential(owner, id, patch) {
    const c = state.credentials.get(owner)?.get(id);
    if (!c) return;
    if (patch.models) c.models = patch.models;
    if (patch.enabledModelIds) c.enabledModelIds = patch.enabledModelIds;
    if (patch.discoveryNote === null) delete c.discoveryNote;
    else if (patch.discoveryNote !== undefined) c.discoveryNote = patch.discoveryNote;
  },
  async removeCredential(owner, id) {
    const removed = state.credentials.get(owner)?.delete(id) ?? false;
    if (removed) state.secrets.delete(id);
    return removed;
  },
  async credentialSecret(owner, id) {
    return state.credentials.get(owner)?.has(id) ? state.secrets.get(id) : undefined;
  },

  async listConversations(owner) {
    return [...state.conversations.values()]
      .filter((c) => c.owner === owner)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(summary);
  },
  async getConversation(owner, id) {
    const c = ownConversation(owner, id);
    if (!c) return undefined;
    const { owner: _o, ...rest } = c;
    return clone(rest);
  },
  async createConversation(owner, opts) {
    const mine = await this.listConversations(owner);
    if (mine.length >= MAX_CONVERSATIONS) state.conversations.delete(mine[mine.length - 1]!.id);
    const now = new Date();
    const conv: ConversationRecord = {
      id: randomUUID(),
      title: null,
      modelPolicy: opts.modelPolicy,
      systemPrompt: opts.systemPrompt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    state.conversations.set(conv.id, { ...conv, messages: [], owner });
    return clone(conv);
  },
  async updateConversation(owner, id, patch) {
    const c = ownConversation(owner, id);
    if (!c) return;
    if (patch.title !== undefined) c.title = patch.title;
    if (patch.modelPolicy !== undefined) c.modelPolicy = patch.modelPolicy;
    c.updatedAt = new Date();
  },
  async deleteConversation(owner, id) {
    if (!ownConversation(owner, id)) return false;
    return state.conversations.delete(id);
  },
  async addMessage(owner, conversationId, msg) {
    const c = ownConversation(owner, conversationId);
    if (!c) return;
    const stored: MessageRecord = { ...clone(msg), createdAt: new Date() };
    c.messages.push(stored);
    c.updatedAt = new Date();
  },

  async countRouterKeys(owner) {
    return [...state.routerKeys.values()].filter((k) => k.owner === owner).length;
  },
  async createRouterKey(owner, keyHash, last4) {
    const id = randomUUID();
    state.routerKeys.set(keyHash, { id, owner, last4, createdAt: new Date() });
    return id;
  },
  async listRouterKeys(owner) {
    return [...state.routerKeys.values()]
      .filter((k) => k.owner === owner)
      .map((k) => ({ id: k.id, last4: k.last4, createdAt: k.createdAt.toISOString() }));
  },
  async revokeRouterKey(owner, id) {
    for (const [hash, k] of state.routerKeys) {
      if (k.id === id && k.owner === owner) {
        state.routerKeys.delete(hash);
        return true;
      }
    }
    return false;
  },
  async ownerFromRouterKeyHash(keyHash) {
    return state.routerKeys.get(keyHash)?.owner;
  },

  async recordRuns() {},
  async audit() {},
};
