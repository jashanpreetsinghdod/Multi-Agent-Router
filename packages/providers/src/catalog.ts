import type { Capabilities, Provider } from '@omnirouter/canonical';
import type { ModelInfo } from './types.js';

interface SeedEntry {
  provider: Provider;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Capabilities;
  pricing: ModelInfo['pricing'];
  status?: ModelInfo['status'];
}

const base: Capabilities = {
  vision: false,
  pdf: false,
  tools: false,
  structuredOutput: false,
  promptCaching: false,
  reasoning: false,
  streaming: true,
};

const frontier: Capabilities = {
  ...base,
  vision: true,
  pdf: true,
  tools: true,
  structuredOutput: true,
  promptCaching: true,
  reasoning: true,
};

const frontierNoReasoning: Capabilities = { ...frontier, reasoning: false };

const SEED: SeedEntry[] = [
  // ── Anthropic ────────────────────────────────────────────────────────────
  {
    provider: 'anthropic',
    modelId: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: frontier,
    pricing: { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: frontier,
    pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
  },
  {
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    displayName: 'Claude Haiku 5.5',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    capabilities: frontier,
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  },
  {
    provider: 'anthropic',
    modelId: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: frontier,
    pricing: { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    capabilities: frontier,
    pricing: { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 },
  },

  {
    provider: 'openai',
    modelId: 'gpt-4.1',
    displayName: 'GPT-4.1',
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    capabilities: frontierNoReasoning,
    pricing: { inputPerMTok: 2, outputPerMTok: 8, cacheReadPerMTok: 0.5 },
  },
  {
    provider: 'openai',
    modelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 mini',
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    capabilities: frontierNoReasoning,
    pricing: { inputPerMTok: 0.4, outputPerMTok: 1.6, cacheReadPerMTok: 0.1 },
  },
  {
    provider: 'openai',
    modelId: 'gpt-4.1-nano',
    displayName: 'GPT-4.1 nano',
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    capabilities: frontierNoReasoning,
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4, cacheReadPerMTok: 0.025 },
  },
  {
    provider: 'openai',
    modelId: 'o4-mini',
    displayName: 'o4-mini',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    capabilities: { ...frontier, reasoning: true },
    pricing: { inputPerMTok: 1.1, outputPerMTok: 4.4, cacheReadPerMTok: 0.275 },
  },

  // ── Google ───────────────────────────────────────────────────────────────
  {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    capabilities: { ...frontier, reasoning: true },
    pricing: { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.31 },
  },
  {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    capabilities: { ...frontier, reasoning: true },
    pricing: { inputPerMTok: 0.3, outputPerMTok: 2.5, cacheReadPerMTok: 0.075 },
  },
  {
    provider: 'google',
    modelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash-Lite',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    capabilities: { ...frontier, reasoning: false },
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  },
];

export const MODEL_CATALOG: readonly ModelInfo[] = SEED.map((entry) => ({
  provider: entry.provider,
  modelId: entry.modelId,
  routerId: `${entry.provider}/${entry.modelId}`,
  displayName: entry.displayName,
  contextWindow: entry.contextWindow,
  maxOutputTokens: entry.maxOutputTokens,
  capabilities: entry.capabilities,
  pricing: entry.pricing,
  status: entry.status ?? 'available',
}));

export function modelsFor(provider: Provider): ModelInfo[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

export function findModel(id: string): ModelInfo | undefined {
  return (
    MODEL_CATALOG.find((m) => m.routerId === id) ??
    MODEL_CATALOG.find((m) => m.modelId === id)
  );
}

export const QUALITY_PRIOR: Record<string, Record<string, number>> = {
  reasoning: {
    'anthropic/claude-opus-5-5': 0.97,
    'anthropic/claude-sonnet-5-5': 0.9,
    'anthropic/claude-opus-4-8': 0.93,
    'openai/o4-mini': 0.88,
    'openai/gpt-4.1': 0.86,
    'google/gemini-2.5-pro': 0.9,
    'google/gemini-2.5-flash': 0.78,
  },
  code: {
    'anthropic/claude-opus-5-5': 0.97,
    'anthropic/claude-sonnet-5-5': 0.93,
    'anthropic/claude-haiku-5-5': 0.8,
    'anthropic/claude-opus-4-8': 0.93,
    'anthropic/claude-sonnet-4-6': 0.88,
    'openai/gpt-4.1': 0.89,
    'openai/o4-mini': 0.88,
    'google/gemini-2.5-pro': 0.88,
    'google/gemini-2.5-flash': 0.81,
  },
  writing: {
    'anthropic/claude-opus-5-5': 0.96,
    'anthropic/claude-sonnet-5-5': 0.92,
    'anthropic/claude-opus-4-8': 0.91,
    'openai/gpt-4.1': 0.9,
    'google/gemini-2.5-pro': 0.88,
    'google/gemini-2.5-flash': 0.8,
  },
  vision: {
    'anthropic/claude-opus-5-5': 0.94,
    'anthropic/claude-sonnet-5-5': 0.9,
    'openai/gpt-4.1': 0.88,
    'google/gemini-2.5-pro': 0.92,
    'google/gemini-2.5-flash': 0.84,
  },
  summarization: {
    'anthropic/claude-haiku-5-5': 0.86,
    'anthropic/claude-sonnet-5-5': 0.9,
    'openai/gpt-4.1-mini': 0.87,
    'openai/gpt-4.1-nano': 0.78,
    'google/gemini-2.5-flash': 0.88,
    'google/gemini-2.5-flash-lite': 0.79,
  },
  general: {
    'anthropic/claude-opus-5-5': 0.95,
    'anthropic/claude-sonnet-5-5': 0.91,
    'anthropic/claude-haiku-5-5': 0.78,
    'anthropic/claude-opus-4-8': 0.92,
    'openai/gpt-4.1': 0.89,
    'openai/gpt-4.1-mini': 0.82,
    'openai/gpt-4.1-nano': 0.72,
    'openai/o4-mini': 0.86,
    'google/gemini-2.5-pro': 0.89,
    'google/gemini-2.5-flash': 0.84,
    'google/gemini-2.5-flash-lite': 0.74,
  },
};
