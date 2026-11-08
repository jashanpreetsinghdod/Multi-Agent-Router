import {
  estimateRequestTokens,
  type CanonicalMessage,
  type ChatRequest,
} from '@omnirouter/canonical';

export const CONTINUATION_INSTRUCTION =
  'Your previous reply was cut off during a handoff from another model, shown in the assistant message above. Continue exactly where that partial reply left off: do not repeat any of it, do not restart the answer, just finish it naturally.';

export interface Continuation {
  partialText: string;
  from: { provider: string; model: string };
}

export function buildContinuationRequest(
  request: ChatRequest,
  continuation: Continuation,
): ChatRequest {
  const partial = continuation.partialText.slice(-8000);
  return {
    ...request,
    messages: [
      ...request.messages,
      {
        role: 'assistant',
        blocks: [{ type: 'text', text: partial }],
        producedBy: { provider: continuation.from.provider, model: continuation.from.model },
      } satisfies CanonicalMessage,
      {
        role: 'user',
        blocks: [{ type: 'text', text: CONTINUATION_INSTRUCTION }],
      } satisfies CanonicalMessage,
    ],
  };
}

function hasToolResult(message: CanonicalMessage): boolean {
  return message.blocks.some((block) => block.type === 'tool_result');
}

function isTurnStart(message: CanonicalMessage | undefined): boolean {
  return message?.role === 'user' && !hasToolResult(message);
}

export function dropOldestTurn(request: ChatRequest): ChatRequest | null {
  const messages = request.messages;
  if (messages.length <= 2) return null;

  let i = 0;
  while (i < messages.length && !isTurnStart(messages[i])) i++;
  if (i >= messages.length) return null;

  let j = i + 1;
  while (j < messages.length && !isTurnStart(messages[j])) j++;

  const dropCount = j - i;
  if (dropCount <= 0) return null;
  if (j >= messages.length) return null;

  return { ...request, messages: messages.slice(j) };
}

export function compactRequest(request: ChatRequest, contextWindow: number): ChatRequest {
  const target = Math.max(2048, Math.floor(contextWindow * 0.6));
  let current = request;
  while (estimateRequestTokens(current) > target) {
    const next = dropOldestTurn(current);
    if (!next) break;
    if (estimateRequestTokens(next) >= estimateRequestTokens(current)) break;
    current = next;
  }
  return current;
}
