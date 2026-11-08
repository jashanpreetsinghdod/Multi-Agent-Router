import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  real,
  bigint,
  numeric,
} from 'drizzle-orm/pg-core';

// ── Identity (Better Auth) ───────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 320 }).notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  password: text('password'),
  retainPrompts: boolean('retain_prompts')
    .notNull()
    .default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  userIdIndex: index('sessions_user_id_idx').on(t.userId),
  tokenIndex: uniqueIndex('sessions_token_idx').on(t.token),
}));

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  accessToken: text('access_token'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  providerAccountIndex: uniqueIndex('accounts_provider_account_idx').on(
    t.providerId,
    t.accountId,
  ),
}));

// ── Tenancy ──────────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  monthlyUsdCap: numeric('monthly_usd_cap', { precision: 12, scale: 6 }),
  disabledProviders: jsonb('disabled_providers')
    .notNull()
    .default([])
    .$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const members = pgTable(
  'members',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull().default('member'),
  },
  (t) => ({
    pk: primaryKey(t.userId, t.organizationId),
    orgIndex: index('members_org_idx').on(t.organizationId),
  }),
);

// ── Provider credentials (the BYOK vault) ────────────────────────────────────

export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    label: varchar('label', { length: 100 }).notNull().default(''),
    baseUrl: text('base_url'),
    authHeader: varchar('auth_header', { length: 64 }),
    ciphertext: text('ciphertext').notNull(),
    dekWrapped: text('dek_wrapped').notNull(),
    dekVersion: integer('dek_version').notNull().default(1),
    keyLast4: varchar('key_last4', { length: 4 }).notNull(),
    keyFingerprint: varchar('key_fingerprint', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    models: jsonb('models').notNull().default([]).$type<unknown[]>(),
    enabledModelIds: jsonb('enabled_model_ids').notNull().default([]).$type<string[]>(),
    discoveryNote: text('discovery_note'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userProviderIndex: index('provider_credentials_user_provider_idx').on(
      t.userId,
      t.provider,
    ),
    fingerprintIndex: index('provider_credentials_fingerprint_idx').on(
      t.keyFingerprint,
    ),
  }),
);

// ── Model catalog ────────────────────────────────────────────────────────────

export const models = pgTable(
  'models',
  {
    provider: varchar('provider', { length: 32 }).notNull(),
    modelId: varchar('model_id', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    contextWindow: integer('context_window').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    capabilities: jsonb('capabilities').notNull(),
    inputPrice: numeric('input_price', { precision: 10, scale: 6 }).notNull(),
    outputPrice: numeric('output_price', { precision: 10, scale: 6 }).notNull(),
    cacheReadPrice: numeric('cache_read_price', { precision: 10, scale: 6 }),
    cacheWritePrice: numeric('cache_write_price', { precision: 10, scale: 6 }),
    status: varchar('status', { length: 16 }).notNull().default('available'),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    qualityPrior: jsonb('quality_prior').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.provider, t.modelId),
  }),
);

// ── Conversations ─────────────────────────────────────────────────────────────

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }),
  modelPolicy: varchar('model_policy', { length: 160 }).notNull().default('auto'),
  systemPrompt: text('system_prompt'),
  pinnedModel: varchar('pinned_model', { length: 160 }),
  compactedAt: timestamp('compacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  userIndex: index('conversations_user_idx').on(t.userId),
}));

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).notNull(),
    content: jsonb('content').notNull(),
    provider: varchar('provider', { length: 32 }),
    modelId: varchar('model_id', { length: 128 }),
    runId: uuid('run_id'),
    isPartial: boolean('is_partial').notNull().default(false),
    meta: jsonb('meta').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    conversationIndex: index('messages_conversation_idx').on(t.conversationId),
    runIndex: index('messages_run_idx').on(t.runId),
  }),
);

// ── Runs: the telemetry backbone ─────────────────────────────────────────────

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    modelId: varchar('model_id', { length: 128 }).notNull(),
    credentialId: uuid('credential_id').references(() => providerCredentials.id, {
      onDelete: 'set null',
    }),
    attemptIndex: integer('attempt_index').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull(),
    errorClass: varchar('error_class', { length: 32 }),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    ttftMs: integer('ttft_ms'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 8 }).notNull().default('0'),
    priceSnapshot: jsonb('price_snapshot').notNull().default({}),
    requestFingerprint: varchar('request_fingerprint', { length: 64 }).notNull(),
    routedReason: text('routed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    conversationIndex: index('runs_conversation_idx').on(t.conversationId),
    userIndex: index('runs_user_idx').on(t.userId),
    fingerprintIndex: index('runs_fingerprint_idx').on(t.requestFingerprint),
    createdIndex: index('runs_created_idx').on(t.createdAt),
  }),
);

// ── Provider health (Redis-mirrored) ─────────────────────────────────────────

export const providerHealth = pgTable(
  'provider_health',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => providerCredentials.id, { onDelete: 'cascade' }),
    state: varchar('state', { length: 12 }).notNull().default('closed'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    successEma: real('success_ema').notNull().default(0.9),
    latencyEmaMs: real('latency_ema_ms').notNull().default(1200),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.userId, t.credentialId),
  }),
);

// ── Router API keys (OpenAI-compatible surface) ─────────────────────────────

export const routerApiKeys = pgTable('router_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 24 }).notNull(),
  label: varchar('label', { length: 100 }).notNull().default(''),
  scopes: jsonb('scopes')
    .notNull()
    .default(['chat'])
    .$type<string[]>(),
  monthlyUsdCap: numeric('monthly_usd_cap', { precision: 12, scale: 6 }),
  requestsPerMinute: integer('requests_per_minute'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  userIndex: index('router_api_keys_user_idx').on(t.userId),
  hashIndex: uniqueIndex('router_api_keys_hash_idx').on(t.keyHash),
}));

// ── Feedback (drives M4 learning) ────────────────────────────────────────────

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  retriedWithModelId: varchar('retried_with_model_id', { length: 160 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  runIndex: index('feedback_run_idx').on(t.runId),
  userIndex: index('feedback_user_idx').on(t.userId),
}));

export const qualityScores = pgTable(
  'quality_scores',
  {
    taskFamily: varchar('task_family', { length: 32 }).notNull(),
    routerModelId: varchar('router_model_id', { length: 160 }).notNull(),
    value: real('value').notNull().default(0.5),
    effectiveCount: integer('effective_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.taskFamily, t.routerModelId),
  }),
);

// Per-user routing weights override the global defaults.
export const routingPolicies = pgTable('routing_policies', {
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  weights: jsonb('weights').notNull(),
  profile: varchar('profile', { length: 32 }).notNull().default('balanced'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Tools ────────────────────────────────────────────────────────────────────

export const toolInvocations = pgTable('tool_invocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tool: varchar('tool', { length: 64 }).notNull(),
  input: jsonb('input'),
  untrustedResult: boolean('untrusted_result').notNull().default(false),
  resultBytes: integer('result_bytes'),
  latencyMs: integer('latency_ms'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 8 }).notNull().default('0'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  runIndex: index('tool_invocations_run_idx').on(t.runId),
}));

// ── Spend rollups (for caps, billed from `runs` by a scheduled job) ─────────

export const usageDaily = pgTable(
  'usage_daily',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: bigint('day', { mode: 'number' }).notNull(), // yyyymmdd
    provider: varchar('provider', { length: 32 }).notNull(),
    requests: integer('requests').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 14, scale: 8 })
      .notNull()
      .default('0'),
  },
  (t) => ({
    pk: primaryKey(t.userId, t.day, t.provider),
  }),
);

// ── Audit ────────────────────────────────────────────────────────────────────

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 64 }).notNull(),
  detail: jsonb('detail'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  userIndex: index('audit_log_user_idx').on(t.userId),
  createdIndex: index('audit_log_created_idx').on(t.createdAt),
}));

export type DbTables = {
  users: typeof users;
  sessions: typeof sessions;
  accounts: typeof accounts;
  organizations: typeof organizations;
  members: typeof members;
  providerCredentials: typeof providerCredentials;
  models: typeof models;
  conversations: typeof conversations;
  messages: typeof messages;
  runs: typeof runs;
  providerHealth: typeof providerHealth;
  routerApiKeys: typeof routerApiKeys;
  feedback: typeof feedback;
  qualityScores: typeof qualityScores;
  routingPolicies: typeof routingPolicies;
  toolInvocations: typeof toolInvocations;
  usageDaily: typeof usageDaily;
  auditLog: typeof auditLog;
};

export const schema = {
  users,
  sessions,
  accounts,
  organizations,
  members,
  providerCredentials,
  models,
  conversations,
  messages,
  runs,
  providerHealth,
  routerApiKeys,
  feedback,
  qualityScores,
  routingPolicies,
  toolInvocations,
  usageDaily,
  auditLog,
} satisfies Record<string, unknown>;
