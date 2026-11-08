import type { Block, Provider } from '@omnirouter/canonical';
import type { ModelInfo } from '@omnirouter/providers';
import type { AttemptRecord } from '@omnirouter/router-core';

export interface CredentialRecord {
  id: string;
  provider: Provider;
  label: string;
  baseUrl?: string;
  keyLast4: string;
  fingerprint: string;
  createdAt: Date;
  models: ModelInfo[];
  enabledModelIds: string[];
  discoveryNote?: string;
}

export interface NewCredential {
  provider: Provider;
  apiKey: string;
  label: string;
  baseUrl?: string;
  models: ModelInfo[];
  enabledModelIds: string[];
  discoveryNote?: string;
}

export interface CredentialPatch {
  models?: ModelInfo[];
  enabledModelIds?: string[];
  discoveryNote?: string | null;
}

export interface MessageMeta {
  switched?: boolean;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
  error?: { errorClass: string; message: string };
}

export interface MessageRecord {
  id: string;
  role: 'user' | 'assistant';
  blocks: Block[];
  provider?: string;
  modelId?: string;
  runId?: string;
  isPartial: boolean;
  meta: MessageMeta;
  createdAt: Date;
}

export interface ConversationRecord {
  id: string;
  title: string | null;
  modelPolicy: string;
  systemPrompt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSummary extends ConversationRecord {
  messageCount: number;
}

export interface ConversationWithMessages extends ConversationRecord {
  messages: MessageRecord[];
}

export interface RouterKeySummary {
  id: string;
  last4: string;
  createdAt: string;
}

export interface RunsInput {
  conversationId: string;
  messageId: string;
  requestFingerprint: string;
  routedReason?: string;
  attempts: AttemptRecord[];
}

export interface Store {
  readonly kind: 'memory' | 'postgres';

  resolveOwner(sessionId: string): Promise<string>;

  listCredentials(owner: string): Promise<CredentialRecord[]>;
  getCredential(owner: string, id: string): Promise<CredentialRecord | undefined>;
  hasFingerprint(owner: string, fingerprint: string): Promise<boolean>;
  addCredential(owner: string, input: NewCredential): Promise<CredentialRecord>;
  updateCredential(owner: string, id: string, patch: CredentialPatch): Promise<void>;
  removeCredential(owner: string, id: string): Promise<boolean>;
  credentialSecret(owner: string, id: string): Promise<string | undefined>;

  listConversations(owner: string): Promise<ConversationSummary[]>;
  getConversation(owner: string, id: string): Promise<ConversationWithMessages | undefined>;
  createConversation(
    owner: string,
    opts: { modelPolicy: string; systemPrompt?: string },
  ): Promise<ConversationRecord>;
  updateConversation(
    owner: string,
    id: string,
    patch: { title?: string; modelPolicy?: string },
  ): Promise<void>;
  deleteConversation(owner: string, id: string): Promise<boolean>;
  addMessage(owner: string, conversationId: string, msg: Omit<MessageRecord, 'createdAt'>): Promise<void>;

  countRouterKeys(owner: string): Promise<number>;
  createRouterKey(owner: string, keyHash: string, last4: string): Promise<string>;
  listRouterKeys(owner: string): Promise<RouterKeySummary[]>;
  revokeRouterKey(owner: string, id: string): Promise<boolean>;
  ownerFromRouterKeyHash(keyHash: string): Promise<string | undefined>;

  recordRuns(owner: string, input: RunsInput): Promise<void>;
  audit(owner: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}
