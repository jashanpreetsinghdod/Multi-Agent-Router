import { useCallback, useRef, useState } from 'react';
import { parseSseChunk } from '@omnirouter/canonical';

export interface RoutedInfo {
  runId: string;
  model: string;
  provider: string;
  reason: string;
  fallbacks: string[];
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AttemptInfo {
  provider: string;
  model: string;
  errorClass: string;
  message: string;
}

export interface ErrorInfo {
  errorClass: string;
  message: string;
  attempts?: AttemptInfo[];
}

export interface ToolActivity {
  id: string;
  name: string;
  state: 'call' | 'result';
  preview?: string;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  provider?: string;
  model?: string;
  routed?: RoutedInfo;
  switched?: boolean;
  tools?: ToolActivity[];
  usage?: UsageInfo;
  error?: ErrorInfo;
  isStreaming: boolean;
}

export interface StoredUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  model?: string;
  switched?: boolean;
  usage?: UsageInfo;
  error?: { errorClass: string; message: string };
}

export interface UseChatOptions {
  conversationId?: string;
  modelPolicy: string;
  tools: boolean;
  onConversationCreated?: (id: string) => void;
  onFinished?: () => void;
}

export function useChat(opts: UseChatOptions) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | undefined>(opts.conversationId);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const sendMessage = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text || abortRef.current) return;

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: text, isStreaming: false },
      { id: assistantId, role: 'assistant', content: '', isStreaming: true },
    ]);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const patch = (fn: (m: UiMessage) => UiMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
          message: text,
          modelPolicy: optsRef.current.modelPolicy,
          tools: optsRef.current.tools,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const convId = res.headers.get('X-Conversation-Id');
      if (convId && convId !== conversationIdRef.current) {
        conversationIdRef.current = convId;
        optsRef.current.onConversationCreated?.(convId);
      }
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split on complete frames only; a frame may span several reads.
        const { events, rest } = parseSseChunk(buffer);
        buffer = rest;
        for (const ev of events) {
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(ev.data);
          } catch {
            continue;
          }
          patch((m) => applyEvent(m, ev.event ?? '', data));
        }
      }
      patch((m) => ({ ...m, isStreaming: false }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        patch((m) => ({ ...m, isStreaming: false, content: m.content || '[Stopped]' }));
      } else {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        patch((m) => ({ ...m, isStreaming: false, error: { errorClass: 'request_failed', message } }));
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      optsRef.current.onFinished?.();
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversationIdRef.current = undefined;
    setMessages([]);
  }, []);

  const load = useCallback((id: string, stored: StoredUiMessage[]) => {
    abortRef.current?.abort();
    conversationIdRef.current = id;
    setMessages(
      stored.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        isStreaming: false,
        ...(m.provider ? { provider: m.provider } : {}),
        ...(m.model ? { model: m.model } : {}),
        ...(m.switched ? { switched: true } : {}),
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.error ? { error: m.error } : {}),
      })),
    );
  }, []);

  return { messages, isLoading, sendMessage, stop, reset, load };
}

function applyEvent(m: UiMessage, type: string, data: Record<string, unknown>): UiMessage {
  switch (type) {
    case 'routed':
      return {
        ...m,
        routed: data as unknown as RoutedInfo,
        provider: data.provider as string,
        model: data.model as string,
      };
    case 'status':
      return {
        ...m,
        provider: data.provider as string,
        model: data.model as string,
        ...(data.phase === 'switched' ? { switched: true } : {}),
      };
    case 'delta':
      return { ...m, content: m.content + String(data.text ?? '') };
    case 'thinking':
      return { ...m, thinking: (m.thinking ?? '') + String(data.text ?? '') };
    case 'tool': {
      const activity: ToolActivity = {
        id: String(data.id),
        name: String(data.name),
        state: data.state === 'result' ? 'result' : 'call',
        ...(typeof data.preview === 'string' ? { preview: data.preview } : {}),
      };
      const others = (m.tools ?? []).filter((t) => t.id !== activity.id);
      const prev = (m.tools ?? []).find((t) => t.id === activity.id);
      // Keep the call's argument preview once the result arrives.
      const merged = prev && activity.state === 'result' ? { ...activity, preview: prev.preview } : activity;
      return { ...m, tools: [...others, merged] };
    }
    case 'usage': {
      const usage = data.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } | undefined;
      return {
        ...m,
        usage: {
          inputTokens: (usage?.inputTokens ?? 0) + (usage?.cacheReadTokens ?? 0),
          outputTokens: usage?.outputTokens ?? 0,
          costUsd: Number(data.costUsd ?? 0),
        },
      };
    }
    case 'done':
      return { ...m, isStreaming: false };
    case 'error':
      return {
        ...m,
        isStreaming: false,
        error: {
          errorClass: String(data.errorClass ?? 'unknown'),
          message: String(data.message ?? 'Request failed'),
          ...(Array.isArray(data.attempts) ? { attempts: data.attempts as AttemptInfo[] } : {}),
        },
      };
    default:
      return m;
  }
}
