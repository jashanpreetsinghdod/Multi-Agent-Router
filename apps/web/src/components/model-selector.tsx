'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface SelectableModel {
  routerId: string;
  provider: string;
  displayName: string;
  keys: number;
  known: boolean;
  tools: boolean;
  pricing: { inputPerMTok: number; outputPerMTok: number } | null;
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  models: SelectableModel[];
}

const AUTO_OPTIONS = [
  { id: 'auto', label: '⚡ Auto', desc: 'Best model for each message' },
  { id: 'auto:cheap', label: '💰 Auto (cheap)', desc: 'Prefer low cost' },
  { id: 'auto:fast', label: '🚀 Auto (fast)', desc: 'Prefer low latency' },
];

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  compatible: 'OpenAI-compatible',
};

export function ModelSelector({ value, onChange, models }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);

  const selected =
    AUTO_OPTIONS.find((o) => o.id === value)?.label ??
    models.find((m) => m.routerId === value)?.displayName ??
    value;

  const byProvider = new Map<string, SelectableModel[]>();
  for (const m of models) {
    byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m]);
  }

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors hover:opacity-80"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
      >
        <span>{selected}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full mt-2 left-0 z-50 rounded-xl py-2 min-w-[280px] max-h-[70vh] overflow-y-auto animate-fade-in"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}
          >
            <Section title="Auto router">
              {AUTO_OPTIONS.map((o) => (
                <Option key={o.id} active={value === o.id} onClick={() => pick(o.id)}>
                  <div>{o.label}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{o.desc}</div>
                </Option>
              ))}
            </Section>

            <div className="mx-3 my-1" style={{ borderTop: '1px solid var(--border)' }} />

            {models.length === 0 ? (
              <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                No models enabled. Add a key and pick models in Settings.
              </div>
            ) : (
              [...byProvider.entries()].map(([provider, list]) => (
                <Section key={provider} title={`Pin · ${PROVIDER_NAMES[provider] ?? provider}`}>
                  {list.map((m) => (
                    <Option key={m.routerId} active={value === m.routerId} onClick={() => pick(m.routerId)}>
                      <div className="flex items-center gap-2">
                        <ProviderDot provider={m.provider} />
                        <span>{m.displayName}</span>
                        {m.keys > 1 && (
                          <span className="text-[10px] px-1.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                            {m.keys} keys
                          </span>
                        )}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {m.pricing
                          ? `$${m.pricing.inputPerMTok}/M in · $${m.pricing.outputPerMTok}/M out`
                          : 'price unknown'}
                        {!m.tools && ' · no tools'}
                      </div>
                    </Option>
                  ))}
                </Section>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-1">
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  );
}

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn('w-full text-left px-3 py-2 rounded-lg text-sm transition-colors hover:bg-[var(--bg-hover)]', active && 'font-medium')}
      style={active ? { background: 'var(--accent-subtle)', color: 'var(--accent-hover)' } : { color: 'var(--text-primary)' }}
    >
      {children}
    </button>
  );
}

export function ProviderDot({ provider }: { provider: string }) {
  const color =
    provider === 'anthropic' ? 'var(--anthropic)' :
    provider === 'openai' ? 'var(--openai)' :
    provider === 'google' ? 'var(--google)' :
    '#a855f7';
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />;
}
