import { z } from 'zod';
import type { ChatRequest } from './request.js';

/**
 * Structural facts about a request, derived without any network call. These
 * are what the router scores against — no classifier model in the hot path.
 */
export const TaskFeaturesSchema = z.object({
  hasImages: z.boolean(),
  hasPdf: z.boolean(),
  usesTools: z.boolean(),
  wantsStructuredOutput: z.boolean(),
  estimatedInputTokens: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative(),
  /** Heuristics below. Useful for routing, never shown to the user as fact. */
  looksLikeCode: z.boolean(),
  looksLikeReasoning: z.boolean(),
  looksLikeSummarization: z.boolean(),
  looksLikeTranslation: z.boolean(),
  longContext: z.boolean(),
});

export type TaskFeatures = z.infer<typeof TaskFeaturesSchema>;

/**
 * Cheap token estimator. Deliberately rough (±15% vs. real tokenizers): it is
 * used for routing and budgeting, never for billing. Providers report exact
 * usage, and that is what gets persisted.
 *
 * Calibrated for mixed English/code at ~4 chars per token, with a floor for
 * CJK, which is closer to 1.5 chars per token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let wide = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x2e80) wide++;
    else ascii++;
  }
  return Math.ceil(ascii / 4 + wide / 1.5);
}

export function estimateRequestTokens(request: ChatRequest): number {
  let total = estimateTokens(request.system ?? '');
  total += (request.tools?.length ?? 0) * 120; // schema overhead, approximate
  for (const message of request.messages) {
    for (const block of message.blocks) {
      switch (block.type) {
        case 'text':
          total += estimateTokens(block.text);
          break;
        case 'image':
          total += 780; // mid-range for one image across the major providers
          break;
        case 'tool_use':
          total += estimateTokens(JSON.stringify(block.input ?? {})) + 20;
          break;
        case 'tool_result':
          total += estimateTokens(block.content) + 10;
          break;
      }
    }
    total += 4; // role/turn framing
  }
  return total;
}

const CODE_SIGNALS = [
  '```',
  'function ',
  'const ',
  'let ',
  'def ',
  'class ',
  'import ',
  'SELECT ',
  'git ',
  'npm ',
  'stack trace',
  'TypeError',
  'NullPointerException',
  'segmentation fault',
];

const REASONING_SIGNALS = [
  'prove',
  'prove that',
  'derive',
  'step by step',
  "step-by-step",
  'reason',
  'algorithm',
  'complexity',
  'optimi',
  'mathematical',
  'probability',
  'counterexample',
  'why does',
  'explain how',
  'debug',
  'architect',
  'trade-off',
  'tradeoff',
];

const SUMMARY_SIGNALS = [
  'summarize',
  'summarise',
  'tl;dr',
  'key points',
  'shorten',
  'condense',
  'bullet points',
];

const TRANSLATE_SIGNALS = [
  'translate',
  'in french',
  'in spanish',
  'in german',
  'in japanese',
  'in chinese',
  'in hindi',
];

function lastUserText(request: ChatRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const message = request.messages[i];
    if (!message || message.role !== 'user') continue;
    const texts = message.blocks
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text);
    if (texts.length) return texts.join('\n');
  }
  return '';
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

export function extractTaskFeatures(request: ChatRequest): TaskFeatures {
  const text = lastUserText(request);
  const estimatedInputTokens = estimateRequestTokens(request);
  const allBlocks = request.messages.flatMap((m) => m.blocks);

  const hasImages = allBlocks.some((b) => b.type === 'image');

  return {
    hasImages,
    hasPdf: false, // PDF blocks are not in the v1 canonical set; see plan §13.
    usesTools: (request.tools?.length ?? 0) > 0,
    wantsStructuredOutput: request.outputSchema !== undefined,
    estimatedInputTokens,
    turnCount: request.messages.length,
    looksLikeCode: containsAny(text, CODE_SIGNALS) || text.includes('```'),
    looksLikeReasoning: containsAny(text, REASONING_SIGNALS),
    looksLikeSummarization: containsAny(text, SUMMARY_SIGNALS),
    looksLikeTranslation: containsAny(text, TRANSLATE_SIGNALS),
    longContext: estimatedInputTokens > 60_000,
  };
}
