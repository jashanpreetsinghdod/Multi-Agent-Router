import {
  estimateRequestTokens,
  type CanonicalMessage,
  type ChatRequest,
} from '@omnirouter/canonical';

/**
 * Continuation prompt sent to the model that takes over after a mid-stream
 * handoff. It is deliberately blunt: the new model already has the full
 * history including the partial assistant turn, so it only needs to finish.
 */
export const CONTINUATION_INSTRUCTION =
  'Your previous reply was cut off during a handoff from another model, shown in the assistant message above. Continue exactly where that partial reply left off: do not repeat any of it, do not restart the answer, just finish it naturally.';

export interface Continuation {
  partialText: string;
  from: { provider: string; model: string };
}

/**
 * Append the partial reply as an assistant turn plus an instruction, so the
 * next model can complete the answer. Appending (never editing earlier turns)
 * is a hard requirement: thinking blocks and provider-side caches are bound
 * to the original history.
 */
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

/**
 * A "turn" is a `user` message that carries no `tool_result` blocks — the
 * start of a self-contained exchange. User messages made purely of tool
 * results are the second half of a tool round and may only be dropped
 * together with the tool_use that triggered them.
 */
function isTurnStart(message: CanonicalMessage | undefined): boolean {
  return message?.role === 'user' && !hasToolResult(message);
}

/**
 * Drop the oldest complete turn. Returns null when nothing more can be
 * dropped without orphaning tool results or emptying the conversation.
 */
export function dropOldestTurn(request: ChatRequest): ChatRequest | null {
  const messages = request.messages;
  if (messages.length <= 2) return null;

  let i = 0;
  while (i < messages.length && !isTurnStart(messages[i])) i++;
  if (i >= messages.length) return null;

  // The next turn start — or the end, if the rest of the conversation is one
  // long tool round belonging to turn `i`.
  let j = i + 1;
  while (j < messages.length && !isTurnStart(messages[j])) j++;

  const dropCount = j - i;
  if (dropCount <= 0) return null;
  // If the drop would run past the last user turn, the remaining messages
  // would be orphaned tool results — not a valid conversation.
  if (j >= messages.length) return null;

  return { ...request, messages: messages.slice(j) };
}

/**
 * Repeatedly drop oldest turns until the request fits under ~60% of the
 * target context window. 60% leaves headroom for the model's reply and tool
 * output, which the estimate does not include.
 *
 * This is the *cheap* compaction: a lossy turn-drop, not a summary. A
 * summarizer (extra LLM call) is a deliberate upgrade, not a default,
 * because it costs money and latency on exactly the path where the user is
 * already waiting.
 */
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
