import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  asc,
  auditLog,
  conversations,
  createDb,
  createPool,
  desc,
  eq,
  guestSessions,
  isNull,
  messages,
  providerCredentials,
  routerApiKeys,
  runs,
  sql,
  users,
  type Database,
  type Pool,
} from '@omnirouter/db';
import { decryptKey, encryptKey } from '@omnirouter/crypto';
import type { Block, Provider } from '@omnirouter/canonical';
import type { ModelInfo } from '@omnirouter/providers';
import type {
  ConversationRecord,
  CredentialRecord,
  MessageMeta,
  Store,
} from './types';

const MAX_OWNER_CACHE = 10_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function masterKey(): string {
  const key = process.env.OMNIROUTER_MASTER_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error(
      'OMNIROUTER_MASTER_KEY must be 64 hex characters when DATABASE_URL is set. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return key;
}

type CredRow = Pick<
  typeof providerCredentials.$inferSelect,
  'id' | 'provider' | 'label' | 'baseUrl' | 'keyLast4' | 'keyFingerprint' | 'createdAt' | 'models' | 'enabledModelIds' | 'discoveryNote'
>;

function toCredential(row: CredRow): CredentialRecord {
  return {
    id: row.id,
    provider: row.provider as Provider,
    label: row.label,
    ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    keyLast4: row.keyLast4,
    fingerprint: row.keyFingerprint,
    createdAt: row.createdAt,
    models: (row.models ?? []) as ModelInfo[],
    enabledModelIds: row.enabledModelIds ?? [],
    ...(row.discoveryNote ? { discoveryNote: row.discoveryNote } : {}),
  };
}

function toConversation(row: typeof conversations.$inferSelect): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    modelPolicy: row.modelPolicy,
    systemPrompt: row.systemPrompt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const credentialColumns = {
  id: providerCredentials.id,
  provider: providerCredentials.provider,
  label: providerCredentials.label,
  baseUrl: providerCredentials.baseUrl,
  keyLast4: providerCredentials.keyLast4,
  keyFingerprint: providerCredentials.keyFingerprint,
  models: providerCredentials.models,
  enabledModelIds: providerCredentials.enabledModelIds,
  discoveryNote: providerCredentials.discoveryNote,
  createdAt: providerCredentials.createdAt,
};

const g = globalThis as unknown as {
  __omniPool?: Pool;
  __omniDb?: Database;
  __omniOwners?: Map<string, string>;
};

/** One pool per process, shared by the store and Better Auth. */
export function getPool(): Pool {
  return (g.__omniPool ??= createPool());
}

export function createPostgresStore(): Store {
  masterKey(); // fail fast on misconfiguration
  const db = (g.__omniDb ??= createDb(getPool()));
  const ownerCache = (g.__omniOwners ??= new Map());

  function remember(token: string, userId: string) {
    if (ownerCache.size >= MAX_OWNER_CACHE) ownerCache.clear();
    ownerCache.set(token, userId);
  }

  async function findGuest(token: string): Promise<string | undefined> {
    const cached = ownerCache.get(token);
    if (cached) return cached;
    const rows = await db
      .select({ userId: guestSessions.userId })
      .from(guestSessions)
      .where(eq(guestSessions.token, token))
      .limit(1);
    const userId = rows[0]?.userId;
    if (userId) remember(token, userId);
    return userId;
  }

  async function ownsConversation(owner: string, id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, owner)))
      .limit(1);
    return rows.length > 0;
  }

  return {
    kind: 'postgres',

    async resolveOwner(sessionId) {
      const token = sha256(sessionId);
      const existing = await findGuest(token);
      if (existing) return existing;

      const [user] = await db
        .insert(users)
        .values({ name: 'Guest', email: `anon+${randomUUID()}@anonymous.invalid` })
        .returning({ id: users.id });
      // Two parallel first requests race here; the primary key on token makes
      // one lose, and the loser drops its orphan user and reads the winner.
      const inserted = await db
        .insert(guestSessions)
        .values({ userId: user!.id, token })
        .onConflictDoNothing({ target: guestSessions.token })
        .returning({ userId: guestSessions.userId });
      let userId = inserted[0]?.userId;
      if (!userId) {
        await db.delete(users).where(eq(users.id, user!.id));
        userId = (await findGuest(token))!;
      }
      remember(token, userId);
      return userId;
    },

    async findGuestOwner(sessionId) {
      return findGuest(sha256(sessionId));
    },

    async mergeOwners(from, to) {
      if (from === to) return { credentials: 0, conversations: 0 };
      const result = await db.transaction(async (tx) => {
        // Same API key on both sides: keep the signed-in user's copy.
        await tx.execute(sql`
          delete from ${providerCredentials} g
          where g.user_id = ${from}
            and exists (select 1 from ${providerCredentials} u
                        where u.user_id = ${to} and u.key_fingerprint = g.key_fingerprint)`);
        const creds = await tx
          .update(providerCredentials)
          .set({ userId: to })
          .where(eq(providerCredentials.userId, from))
          .returning({ id: providerCredentials.id });
        const convs = await tx
          .update(conversations)
          .set({ userId: to })
          .where(eq(conversations.userId, from))
          .returning({ id: conversations.id });
        await tx.update(runs).set({ userId: to }).where(eq(runs.userId, from));
        await tx.update(routerApiKeys).set({ userId: to }).where(eq(routerApiKeys.userId, from));
        await tx.update(auditLog).set({ userId: to }).where(eq(auditLog.userId, from));
        // Only delete true guests; never a real account.
        await tx.delete(users).where(and(eq(users.id, from), sql`${users.email} like 'anon+%@anonymous.invalid'`));
        return { credentials: creds.length, conversations: convs.length };
      });
      for (const [token, id] of ownerCache) if (id === from) ownerCache.delete(token);
      return result;
    },

    // ── credentials ────────────────────────────────────────────────────────
    async listCredentials(owner) {
      const rows = await db
        .select(credentialColumns)
        .from(providerCredentials)
        .where(eq(providerCredentials.userId, owner))
        .orderBy(asc(providerCredentials.createdAt));
      return rows.map(toCredential);
    },

    async getCredential(owner, id) {
      if (!isUuid(id)) return undefined;
      const rows = await db
        .select(credentialColumns)
        .from(providerCredentials)
        .where(and(eq(providerCredentials.id, id), eq(providerCredentials.userId, owner)))
        .limit(1);
      return rows[0] ? toCredential(rows[0]) : undefined;
    },

    async hasFingerprint(owner, fingerprint) {
      const rows = await db
        .select({ id: providerCredentials.id })
        .from(providerCredentials)
        .where(and(eq(providerCredentials.userId, owner), eq(providerCredentials.keyFingerprint, fingerprint)))
        .limit(1);
      return rows.length > 0;
    },

    async addCredential(owner, input) {
      const enc = await encryptKey(input.apiKey, masterKey());
      const [row] = await db
        .insert(providerCredentials)
        .values({
          userId: owner,
          provider: input.provider,
          label: input.label,
          baseUrl: input.baseUrl ?? null,
          ciphertext: enc.ciphertext,
          dekWrapped: enc.dekWrapped,
          dekVersion: enc.dekVersion,
          keyLast4: enc.keyLast4,
          keyFingerprint: enc.keyFingerprint,
          models: input.models,
          enabledModelIds: input.enabledModelIds,
          discoveryNote: input.discoveryNote ?? null,
          lastValidatedAt: input.discoveryNote ? null : new Date(),
        })
        .returning(credentialColumns);
      return toCredential(row!);
    },

    async updateCredential(owner, id, patch) {
      if (!isUuid(id)) return;
      const set: Partial<typeof providerCredentials.$inferInsert> = {};
      if (patch.models) {
        set.models = patch.models;
        set.lastValidatedAt = new Date();
      }
      if (patch.enabledModelIds) set.enabledModelIds = patch.enabledModelIds;
      if (patch.discoveryNote !== undefined) set.discoveryNote = patch.discoveryNote;
      if (Object.keys(set).length === 0) return;
      await db
        .update(providerCredentials)
        .set(set)
        .where(and(eq(providerCredentials.id, id), eq(providerCredentials.userId, owner)));
    },

    async removeCredential(owner, id) {
      if (!isUuid(id)) return false;
      const rows = await db
        .delete(providerCredentials)
        .where(and(eq(providerCredentials.id, id), eq(providerCredentials.userId, owner)))
        .returning({ id: providerCredentials.id });
      return rows.length > 0;
    },

    async credentialSecret(owner, id) {
      if (!isUuid(id)) return undefined;
      const rows = await db
        .select({ ciphertext: providerCredentials.ciphertext, dekWrapped: providerCredentials.dekWrapped })
        .from(providerCredentials)
        .where(and(eq(providerCredentials.id, id), eq(providerCredentials.userId, owner)))
        .limit(1);
      const row = rows[0];
      return row ? decryptKey(row, masterKey()) : undefined;
    },

    // ── conversations ──────────────────────────────────────────────────────
    async listConversations(owner) {
      const rows = await db
        .select({
          conv: conversations,
          messageCount: sql<number>`(select count(*)::int from ${messages} where ${messages.conversationId} = ${conversations.id})`,
        })
        .from(conversations)
        .where(eq(conversations.userId, owner))
        .orderBy(desc(conversations.updatedAt))
        .limit(200);
      return rows.map((r) => ({ ...toConversation(r.conv), messageCount: Number(r.messageCount) }));
    },

    async getConversation(owner, id) {
      if (!isUuid(id)) return undefined;
      const convRows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, owner)))
        .limit(1);
      const conv = convRows[0];
      if (!conv) return undefined;
      const msgRows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(asc(messages.createdAt));
      return {
        ...toConversation(conv),
        messages: msgRows.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          blocks: m.content as Block[],
          ...(m.provider ? { provider: m.provider } : {}),
          ...(m.modelId ? { modelId: m.modelId } : {}),
          ...(m.runId ? { runId: m.runId } : {}),
          isPartial: m.isPartial,
          meta: (m.meta ?? {}) as MessageMeta,
          createdAt: m.createdAt,
        })),
      };
    },

    async createConversation(owner, opts) {
      const [row] = await db
        .insert(conversations)
        .values({ userId: owner, modelPolicy: opts.modelPolicy, systemPrompt: opts.systemPrompt ?? null })
        .returning();
      return toConversation(row!);
    },

    async updateConversation(owner, id, patch) {
      if (!isUuid(id)) return;
      await db
        .update(conversations)
        .set({
          ...(patch.title !== undefined ? { title: patch.title.slice(0, 200) } : {}),
          ...(patch.modelPolicy !== undefined ? { modelPolicy: patch.modelPolicy.slice(0, 160) } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(conversations.id, id), eq(conversations.userId, owner)));
    },

    async deleteConversation(owner, id) {
      if (!isUuid(id)) return false;
      const rows = await db
        .delete(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, owner)))
        .returning({ id: conversations.id });
      return rows.length > 0;
    },

    async addMessage(owner, conversationId, msg) {
      if (!(await ownsConversation(owner, conversationId))) return;
      await db.insert(messages).values({
        id: msg.id,
        conversationId,
        role: msg.role,
        content: msg.blocks,
        provider: msg.provider ?? null,
        modelId: msg.modelId?.slice(0, 128) ?? null,
        runId: msg.runId && isUuid(msg.runId) ? msg.runId : null,
        isPartial: msg.isPartial,
        meta: msg.meta,
      });
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, owner)));
    },

    // ── router keys ────────────────────────────────────────────────────────
    async countRouterKeys(owner) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(routerApiKeys)
        .where(and(eq(routerApiKeys.userId, owner), isNull(routerApiKeys.revokedAt)));
      return Number(row?.n ?? 0);
    },

    async createRouterKey(owner, keyHash, last4) {
      const [row] = await db
        .insert(routerApiKeys)
        .values({ userId: owner, keyHash, keyPrefix: `sk-router-…${last4}` })
        .returning({ id: routerApiKeys.id });
      return row!.id;
    },

    async listRouterKeys(owner) {
      const rows = await db
        .select({ id: routerApiKeys.id, prefix: routerApiKeys.keyPrefix, createdAt: routerApiKeys.createdAt })
        .from(routerApiKeys)
        .where(and(eq(routerApiKeys.userId, owner), isNull(routerApiKeys.revokedAt)))
        .orderBy(asc(routerApiKeys.createdAt));
      return rows.map((r) => ({ id: r.id, last4: r.prefix.slice(-4), createdAt: r.createdAt.toISOString() }));
    },

    async revokeRouterKey(owner, id) {
      if (!isUuid(id)) return false;
      const rows = await db
        .update(routerApiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(routerApiKeys.id, id), eq(routerApiKeys.userId, owner), isNull(routerApiKeys.revokedAt)))
        .returning({ id: routerApiKeys.id });
      return rows.length > 0;
    },

    async ownerFromRouterKeyHash(keyHash) {
      const rows = await db
        .update(routerApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(routerApiKeys.keyHash, keyHash), isNull(routerApiKeys.revokedAt)))
        .returning({ userId: routerApiKeys.userId });
      return rows[0]?.userId;
    },

    // ── telemetry + audit ──────────────────────────────────────────────────
    async recordRuns(owner, input) {
      if (input.attempts.length === 0) return;
      if (!(await ownsConversation(owner, input.conversationId))) return;
      await db.insert(runs).values(
        input.attempts.map((a) => {
          const [provider, ...rest] = a.model.split('/');
          return {
            conversationId: input.conversationId,
            messageId: input.messageId,
            userId: owner,
            provider: (a.provider || provider || 'unknown').slice(0, 32),
            modelId: (rest.join('/') || a.model).slice(0, 128),
            attemptIndex: a.index,
            status: a.status,
            errorClass: a.errorClass ?? null,
            httpStatus: a.httpStatus ?? null,
            ttftMs: a.ttftMs ?? null,
            inputTokens: a.inputTokens,
            outputTokens: a.outputTokens,
            cachedTokens: a.cachedTokens,
            costUsd: a.costUsd.toFixed(8),
            requestFingerprint: input.requestFingerprint,
            routedReason: input.routedReason ?? null,
          };
        }),
      );
    },

    async audit(owner, action, detail) {
      await db.insert(auditLog).values({ userId: owner, action, detail: detail ?? null });
    },
  };
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
