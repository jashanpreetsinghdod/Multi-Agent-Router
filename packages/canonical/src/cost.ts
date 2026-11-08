import type { Usage } from './response.js';

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

const ONE_MILLION = 1_000_000;

export function computeCostUsd(usage: Usage, pricing: Pricing): number {
  const cacheRead = pricing.cacheReadPerMTok ?? pricing.inputPerMTok;
  const cacheWrite = pricing.cacheWritePerMTok ?? pricing.inputPerMTok;

  const billableInput = Math.max(
    0,
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
  );

  const cost =
    (billableInput / ONE_MILLION) * pricing.inputPerMTok +
    (usage.outputTokens / ONE_MILLION) * pricing.outputPerMTok +
    (usage.cacheReadTokens / ONE_MILLION) * cacheRead +
    (usage.cacheWriteTokens / ONE_MILLION) * cacheWrite;

  return Math.round(cost * 1e8) / 1e8;
}

export const costOf = computeCostUsd;
