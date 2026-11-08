import {
  computeCostUsd,
  extractTaskFeatures,
  type ChatRequest,
  type Usage,
} from '@omnirouter/canonical';
import type { ModelInfo } from '@omnirouter/providers';
import type { CredentialHealth } from './types.js';

export interface ScoreInput {
  model: ModelInfo;
  request: ChatRequest;
  health: CredentialHealth;
  quality: number;
  weights: { quality: number; cost: number; latency: number; reliability: number };
  maxCost: number;
  maxTtft: number;
}

export function estimatedUsage(request: ChatRequest, features: ReturnType<typeof extractTaskFeatures>): Usage {
  const output = Math.min(
    4096,
    Math.max(256, Math.round(features.estimatedInputTokens * 0.4)),
  );
  return {
    inputTokens: features.estimatedInputTokens,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function scoreCandidate(input: ScoreInput): number {
  const { model, request, health, quality, weights, maxCost, maxTtft } = input;

  const features = extractTaskFeatures(request);
  const usage = estimatedUsage(request, features);

  const cost = model.pricing
    ? computeCostUsd(usage, {
        inputPerMTok: model.pricing.inputPerMTok,
        outputPerMTok: model.pricing.outputPerMTok,
        ...(model.pricing.cacheReadPerMTok !== undefined
          ? { cacheReadPerMTok: model.pricing.cacheReadPerMTok }
          : {}),
        ...(model.pricing.cacheWritePerMTok !== undefined
          ? { cacheWritePerMTok: model.pricing.cacheWritePerMTok }
          : {}),
      })
    : Number.POSITIVE_INFINITY;

  const normalizedCost = Number.isFinite(cost) && maxCost > 0 ? cost / maxCost : 1;
  const normalizedLatency = maxTtft > 0 ? Math.min(1, health.ttftEmaMs / maxTtft) : 0.5;
  const reliability = health.successEma;
  const failureRate = 1 - reliability;

  return (
    weights.quality * quality -
    weights.cost * normalizedCost -
    weights.latency * normalizedLatency -
    weights.reliability * failureRate
  );
}

export function taskFamily(request: ChatRequest): string {
  const features = extractTaskFeatures(request);
  if (features.hasImages) return 'vision';
  if (features.looksLikeReasoning) return 'reasoning';
  if (features.looksLikeCode) return 'code';
  if (features.looksLikeSummarization) return 'summarization';
  if (features.looksLikeTranslation) return 'writing';
  return 'general';
}

export function describeChoice(
  model: ModelInfo,
  quality: number,
  family: string,
  health: CredentialHealth,
): string {
  const bits: string[] = [`best ${family} fit`];
  if (model.pricing) {
    bits.push(`$${model.pricing.inputPerMTok}/$${model.pricing.outputPerMTok} per M tok`);
  }
  bits.push(`quality prior ${(quality * 100).toFixed(0)}`);
  if (health.successEma < 0.8) {
    bits.push(`recent failures (success ${(health.successEma * 100).toFixed(0)}%)`);
  }
  return bits.join(' · ');
}
