import type { Usage } from './response.js';

/**
 * Per-million-token pricing. Stored in the `models` catalog, snapshotted onto
 * each run at request time so historical cost doesn't shift when prices change.
 */
export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cache reads are typically ~10% of input price. Defaults to inputPerMTok. */
  cacheReadPerMTok?: number;
  /** Cache writes carry a premium on some providers (~125% of input). */
  cacheWritePerMTok?: number;
}

const ONE_MILLION = 1_000_000;

/**
 * Costs are computed by us from provider-reported token counts and the price
 * snapshot, never read off the response. Providers disagree about what they
 * report and occasionally report nothing; a single implementation here means
 * the number in the UI always matches the number in the usage table.
 */
export function computeCostUsd(usage: Usage, pricing: Pricing): number {
  const cacheRead = pricing.cacheReadPerMTok ?? pricing.inputPerMTok;
  const cacheWrite = pricing.cacheWritePerMTok ?? pricing.inputPerMTok;

  // Providers report input tokens either inclusive or exclusive of cache
  // tokens. Adapters normalize to exclusive, so this stays a plain sum.
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

/** Alias kept for call-site readability. */
export const costOf = computeCostUsd;
