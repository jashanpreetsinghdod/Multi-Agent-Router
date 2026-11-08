'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ToolActivity, UiMessage } from '@/hooks/use-chat';
import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

interface MessageListProps {
  messages: UiMessage[];
  hasKeys: boolean;
}

export function MessageList({ messages, hasKeys }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-4xl mb-4">🌐</div>
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>OmniRouter</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            One chat across Claude, GPT and Gemini. When one provider hits its limit, the next one continues the reply.
          </p>
          <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
            {hasKeys ? 'Ask anything to start.' : 'Add your API keys in Settings to get started.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({ message }: { message: UiMessage }) {
  const isUser = message.role === 'user';
  const [showThinking, setShowThinking] = useState(false);
  const [showRoute, setShowRoute] = useState(false);

  return (
    <div className={cn('animate-fade-in', isUser && 'flex justify-end')}>
      <div
        className={cn('rounded-2xl px-4 py-3', isUser ? 'ml-auto max-w-[85%]' : 'w-full')}
        style={{
          background: isUser ? 'var(--accent-subtle)' : 'transparent',
          border: isUser ? '1px solid var(--border-subtle)' : 'none',
        }}
      >
        {!isUser && message.provider && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <ProviderBadge provider={message.provider} model={message.model} />
            {message.switched && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--error-subtle)', color: 'var(--warning)' }} title="A provider failed mid-reply and another model continued it">
                ↗ switched model
              </span>
            )}
            {message.routed?.reason && (
              <button onClick={() => setShowRoute(!showRoute)} className="text-xs hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
                why this model?
              </button>
            )}
          </div>
        )}
        {showRoute && message.routed && (
          <div className="text-xs mb-2 rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
            <div>{message.routed.reason}</div>
            {message.routed.fallbacks.length > 0 && (
              <div className="mt-1">Fallbacks: {message.routed.fallbacks.join(' → ')}</div>
            )}
          </div>
        )}

        {message.tools && message.tools.length > 0 && <ToolList tools={message.tools} />}

        {message.thinking && (
          <button onClick={() => setShowThinking(!showThinking)} className="text-xs mb-2 flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
            <span>{showThinking ? '▾' : '▸'}</span>
            <span>Thinking</span>
          </button>
        )}
        {showThinking && message.thinking && (
          <div className="text-xs mb-3 pl-3 overflow-x-auto" style={{ borderLeft: '2px solid var(--border)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
            {message.thinking}
          </div>
        )}

        <div className="prose text-sm" style={{ color: 'var(--text-primary)' }}>
          {message.content ? (
            isUser ? (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.content}</div>
            ) : (
              <Markdown content={message.content} />
            )
          ) : message.isStreaming ? (
            <ThinkingDots />
          ) : null}
        </div>

        {message.error && (
          <div className="mt-3 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--error-subtle)', color: 'var(--error)' }}>
            <div className="font-medium">{friendlyError(message.error.errorClass)}</div>
            <div>{message.error.message}</div>
            {message.error.attempts && message.error.attempts.length > 0 && (
              <div className="mt-2 space-y-1">
                {message.error.attempts.map((a, i) => (
                  <div key={i} className="opacity-75">
                    {a.model}: {a.errorClass} · {a.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {message.usage && !message.isStreaming && (message.usage.inputTokens > 0 || message.usage.outputTokens > 0) && (
          <div className="mt-2 text-xs flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
            <span>{message.usage.inputTokens.toLocaleString()} in · {message.usage.outputTokens.toLocaleString()} out</span>
            {message.usage.costUsd > 0 && <span>≈ ${message.usage.costUsd.toFixed(4)}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

function Markdown({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  // renderMarkdown escapes raw HTML and filters link/image URLs; see lib/markdown.ts.
  return <div style={{ wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

const TOOL_LABELS: Record<string, [string, string]> = {
  web_search: ['🔎', 'Searching the web'],
  fetch_url: ['📄', 'Reading page'],
  get_current_time: ['🕒', 'Checking the time'],
};

function ToolList({ tools }: { tools: ToolActivity[] }) {
  return (
    <div className="mb-2 space-y-1">
      {tools.map((t) => {
        const [icon, label] = TOOL_LABELS[t.name] ?? ['🛠', t.name];
        const arg = describeArgs(t.preview);
        return (
          <div key={t.id} className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <span>{icon}</span>
            <span>
              {label}
              {arg && <span style={{ color: 'var(--text-secondary)' }}> · {arg}</span>}
            </span>
            {t.state === 'call' ? <span className="opacity-60">…</span> : <span style={{ color: 'var(--success)' }}>✓</span>}
          </div>
        );
      })}
    </div>
  );
}

function describeArgs(preview: string | undefined): string {
  if (!preview) return '';
  try {
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    return String(parsed.query ?? parsed.url ?? parsed.timezone ?? '').slice(0, 80);
  } catch {
    return '';
  }
}

function friendlyError(cls: string): string {
  switch (cls) {
    case 'no_provider': return 'No models enabled';
    case 'no_capability': return 'No enabled model supports this request';
    case 'no_context': return 'Conversation too long';
    case 'all_cooling_down': return 'All providers are rate-limited right now';
    case 'auth': return 'A provider rejected your API key';
    case 'rate_limit': return 'Rate limited';
    case 'quota': return 'Provider quota exhausted';
    default: return 'Request failed';
  }
}

function ProviderBadge({ provider, model }: { provider: string; model?: string }) {
  const badgeClass =
    provider === 'anthropic' ? 'badge-anthropic' :
    provider === 'openai' ? 'badge-openai' :
    provider === 'google' ? 'badge-google' :
    'badge-compatible';
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', badgeClass)}>
      {model?.split('/').pop() ?? provider}
    </span>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <div className="thinking-dot w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
      <div className="thinking-dot w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
      <div className="thinking-dot w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
    </div>
  );
}
