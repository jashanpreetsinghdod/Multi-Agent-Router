'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, onStop, isLoading, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (isLoading) {
      onStop();
      return;
    }
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="px-3 md:px-4 pt-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
      <div
        className="max-w-3xl mx-auto rounded-2xl flex items-end gap-2 px-4 py-3"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Add an API key to start chatting…' : 'Send a message…'}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent resize-none outline-none text-base md:text-sm placeholder-opacity-50"
          style={{
            color: 'var(--text-primary)',
            maxHeight: '200px',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || (!isLoading && !input.trim())}
          className={cn(
            'shrink-0 w-9 h-9 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all',
            isLoading
              ? 'hover:opacity-80'
              : 'disabled:opacity-30',
          )}
          style={{
            background: isLoading ? 'var(--error)' : 'var(--accent)',
            color: 'white',
          }}
          title={isLoading ? 'Stop' : 'Send'}
        >
          {isLoading ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
      <div
        className="hidden md:block max-w-3xl mx-auto text-center mt-2 text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        Press Enter to send, Shift+Enter for newline
      </div>
    </div>
  );
}

