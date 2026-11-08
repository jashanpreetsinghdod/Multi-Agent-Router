'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProviderDot } from './model-selector';

interface CredentialModel {
  modelId: string;
  routerId: string;
  displayName: string;
  enabled: boolean;
  known: boolean;
  contextWindow: number;
  pricing: { inputPerMTok: number; outputPerMTok: number } | null;
}

interface Credential {
  id: string;
  provider: string;
  label: string;
  keyLast4: string;
  baseUrl?: string;
  createdAt: string;
  discoveryNote?: string;
  models: CredentialModel[];
}

interface RouterKey {
  id: string;
  last4: string;
  createdAt: string;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', placeholder: 'sk-ant-…', help: 'console.anthropic.com → API Keys' },
  { id: 'openai', name: 'OpenAI (GPT)', placeholder: 'sk-…', help: 'platform.openai.com → API keys' },
  { id: 'google', name: 'Google (Gemini)', placeholder: 'AIza…', help: 'aistudio.google.com → Get API key' },
  { id: 'compatible', name: 'OpenAI-compatible', placeholder: 'API key', help: 'OpenRouter, Groq, Together, DeepSeek, Ollama…' },
] as const;

const inputStyle = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
};

export function SettingsPanel({ open, onClose, onChanged }: SettingsPanelProps) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [routerKeys, setRouterKeys] = useState<RouterKey[]>([]);
  const [newRouterKey, setNewRouterKey] = useState<string | null>(null);

  const [provider, setProvider] = useState<string>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [manualModels, setManualModels] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/credentials').then((r) => r.json()).then(setCredentials).catch(() => {});
    fetch('/api/router-keys').then((r) => r.json()).then(setRouterKeys).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const providerInfo = PROVIDERS.find((p) => p.id === provider)!;

  const handleAdd = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError('');
    try {
      const manual = manualModels.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim(),
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(provider === 'compatible' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          ...(manual.length ? { manualModels: manual } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to add key');
      setApiKey('');
      setLabel('');
      setBaseUrl('');
      setManualModels('');
      setCredentials((prev) => [...prev, body as Credential]);
      setExpanded((body as Credential).id); // show the detected models right away
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add key');
    } finally {
      setSaving(false);
    }
  };

  const patchCredential = async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch('/api/credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'Update failed');
    setCredentials((prev) => prev.map((c) => (c.id === id ? (body as Credential) : c)));
    onChanged();
  };

  const handleRemove = async (id: string) => {
    await fetch(`/api/credentials?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setCredentials((prev) => prev.filter((c) => c.id !== id));
    onChanged();
  };

  const createRouterKey = async () => {
    const res = await fetch('/api/router-keys', { method: 'POST' });
    const body = await res.json();
    if (res.ok) {
      setNewRouterKey(body.key);
      load();
    }
  };

  const revokeRouterKey = async (id: string) => {
    await fetch(`/api/router-keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg overflow-y-auto animate-slide-up"
        style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)' }}
      >
        <div className="p-4 md:p-6 space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-80"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              aria-label="Close settings"
            >
              ✕
            </button>
          </div>

          <section>
            <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Your API keys</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              We check each key with the provider and list the models it can use. Pick which ones the router may use.
              Keys are stored encrypted on the server and are never sent back to the page.
            </p>

            {credentials.length > 0 && (
              <div className="space-y-2 mb-4">
                {credentials.map((cred) => (
                  <CredentialCard
                    key={cred.id}
                    cred={cred}
                    expanded={expanded === cred.id}
                    onToggleExpand={() => setExpanded(expanded === cred.id ? null : cred.id)}
                    onPatch={(patch) => patchCredential(cred.id, patch)}
                    onRemove={() => handleRemove(cred.id)}
                  />
                ))}
              </div>
            )}

            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              <Field label="Provider">
                <select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle}>
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Get a key: {providerInfo.help}</div>
              </Field>

              {provider === 'compatible' && (
                <Field label="Base URL">
                  <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} />
                </Field>
              )}

              <Field label="API key">
                <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={providerInfo.placeholder} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} />
              </Field>

              <Field label="Label (optional)">
                <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. work key" maxLength={60} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} />
              </Field>

              {provider === 'compatible' && (
                <Field label="Model ids (optional)">
                  <input type="text" value={manualModels} onChange={(e) => setManualModels(e.target.value)} placeholder="only if the endpoint can't list models, e.g. llama-3.3-70b" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} />
                </Field>
              )}

              {error && <div className="text-xs" style={{ color: 'var(--error)' }}>{error}</div>}

              <button
                onClick={handleAdd}
                disabled={saving || !apiKey.trim()}
                className="w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                {saving ? 'Checking key and detecting models…' : 'Verify key & detect models'}
              </button>
            </div>
          </section>

          <SpendingSection />

          <section>
            <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Use from other apps</h3>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              Cursor, Cline and any OpenAI SDK can use this router. Set the base URL to{' '}
              <code className="px-1 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                {typeof window !== 'undefined' ? window.location.origin : ''}/v1
              </code>{' '}
              and the model to <code className="px-1 rounded" style={{ background: 'var(--bg-tertiary)' }}>auto</code> or a model id.
            </p>

            {newRouterKey && (
              <div className="rounded-lg p-3 mb-3 text-xs" style={{ background: 'var(--accent-subtle)', color: 'var(--text-primary)' }}>
                <div className="mb-1 font-medium">Copy this key now. It will not be shown again.</div>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 break-all">{newRouterKey}</code>
                  <button onClick={() => navigator.clipboard.writeText(newRouterKey)} className="px-2 py-1 rounded" style={{ background: 'var(--accent)', color: 'white' }}>Copy</button>
                  <button onClick={() => setNewRouterKey(null)} className="px-2 py-1 rounded" style={{ background: 'var(--bg-tertiary)' }}>Done</button>
                </div>
              </div>
            )}

            <div className="space-y-2 mb-3">
              {routerKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-primary)' }}>sk-router-…{k.last4}</span>
                  <button onClick={() => revokeRouterKey(k.id)} className="text-xs" style={{ color: 'var(--error)' }}>Revoke</button>
                </div>
              ))}
            </div>
            <button onClick={createRouterKey} className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
              Create router key
            </button>
          </section>

          <section className="rounded-xl p-4 text-xs" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <p className="font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>How OmniRouter works</p>
            <ul className="space-y-1 list-disc pl-4">
              <li>When one provider is rate-limited or down, the next enabled model takes over, mid-reply if needed.</li>
              <li>Two keys for the same provider count as separate fallbacks.</li>
              <li>Auto picks a model per message from quality, cost and recent reliability. Models marked &quot;price unknown&quot; rank lower.</li>
              <li>This adds throughput and continuity across your keys. Each provider&apos;s own limits and billing still apply.</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}

function CredentialCard({
  cred,
  expanded,
  onToggleExpand,
  onPatch,
  onRemove,
}: {
  cred: Credential;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onRemove: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [manualId, setManualId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const enabledCount = cred.models.filter((m) => m.enabled).length;
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f
      ? cred.models.filter((m) => m.modelId.toLowerCase().includes(f) || m.displayName.toLowerCase().includes(f))
      : cred.models;
    // Enabled first, then catalog-known, then the rest.
    return [...list].sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.known) - Number(a.known));
  }, [cred.models, filter]);

  const run = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await onPatch(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (modelId: string) => {
    const next = new Set(cred.models.filter((m) => m.enabled).map((m) => m.modelId));
    if (next.has(modelId)) next.delete(modelId);
    else next.add(modelId);
    void run({ enabledModelIds: [...next] });
  };

  const setVisible = (on: boolean) => {
    const next = new Set(cred.models.filter((m) => m.enabled).map((m) => m.modelId));
    for (const m of visible) {
      if (on) next.add(m.modelId);
      else next.delete(m.modelId);
    }
    void run({ enabledModelIds: [...next] });
  };

  return (
    <div className="rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between px-3 py-2">
        <button onClick={onToggleExpand} className="text-left flex-1">
          <div className="text-sm flex items-center gap-2">
            <ProviderDot provider={cred.provider} />
            <span style={{ color: 'var(--text-primary)' }}>{cred.label}</span>
          </div>
          <div className="text-xs" style={{ color: enabledCount === 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
            …{cred.keyLast4} · {enabledCount} of {cred.models.length} models enabled {expanded ? '▾' : '▸'}
          </div>
        </button>
        <button onClick={onRemove} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ color: 'var(--error)' }}>Remove</button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {cred.discoveryNote && (
            <div className="text-xs pt-2" style={{ color: 'var(--warning)' }}>{cred.discoveryNote}</div>
          )}
          <div className="flex gap-2 pt-2">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter models…" className="flex-1 rounded-lg px-2 py-1 text-xs outline-none" style={inputStyle} />
            <button disabled={busy} onClick={() => setVisible(true)} className="text-xs px-2 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>All</button>
            <button disabled={busy} onClick={() => setVisible(false)} className="text-xs px-2 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>None</button>
            <button disabled={busy} onClick={() => run({ refresh: true })} className="text-xs px-2 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }} title="Ask the provider again for new models">↻</button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {visible.length === 0 && (
              <div className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>No models. Add a model id below.</div>
            )}
            {visible.map((m) => (
              <label key={m.modelId} className="flex items-start gap-2 px-1 py-1 rounded cursor-pointer hover:bg-[var(--bg-hover)]">
                <input type="checkbox" checked={m.enabled} disabled={busy} onChange={() => toggle(m.modelId)} className="mt-0.5" />
                <span className="flex-1 min-w-0">
                  <span className="text-xs block truncate" style={{ color: 'var(--text-primary)' }}>{m.displayName}</span>
                  <span className="text-[11px] block truncate" style={{ color: 'var(--text-muted)' }}>
                    {m.modelId}
                    {m.pricing ? ` · $${m.pricing.inputPerMTok}/$${m.pricing.outputPerMTok} per M` : ' · price unknown'}
                  </span>
                </span>
                {m.known && (
                  <span className="text-[10px] px-1.5 rounded shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}>rated</span>
                )}
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <input value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="Add a model id by hand" className="flex-1 rounded-lg px-2 py-1 text-xs outline-none" style={inputStyle} />
            <button
              disabled={busy || !manualId.trim()}
              onClick={async () => {
                await run({ addModelId: manualId.trim() });
                setManualId('');
              }}
              className="text-xs px-3 rounded disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Add
            </button>
          </div>
          {error && <div className="text-xs" style={{ color: 'var(--error)' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function SpendingSection() {
  const [spent, setSpent] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const apply = (body: { spentUsd: number; capUsd: number | null }) => {
    setSpent(body.spentUsd);
    setCap(body.capUsd);
    setInput(body.capUsd === null ? '' : String(body.capUsd));
  };

  useEffect(() => {
    fetch('/api/usage').then((r) => r.json()).then(apply).catch(() => {});
  }, []);

  const save = async (value: number | null) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/usage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capUsd: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save');
      apply(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    const trimmed = input.trim();
    if (!trimmed) return void save(null);
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return setError('Enter a positive amount, or leave empty for no limit.');
    void save(n);
  };

  const pct = cap && spent !== null ? Math.min(100, (spent / cap) * 100) : 0;

  return (
    <section>
      <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Monthly spending limit</h3>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Chats stop once this month&apos;s estimated cost reaches the limit. Estimates use list prices; models marked
        &quot;price unknown&quot; are not counted. Your provider&apos;s bill is the source of truth.
      </p>
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
          Spent this month: {spent === null ? '…' : `$${spent.toFixed(4)}`}
          {cap !== null && <span style={{ color: 'var(--text-muted)' }}> of ${cap.toFixed(2)}</span>}
        </div>
        {cap !== null && (
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
            <div className="h-full" style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--error)' : 'var(--accent)' }} />
          </div>
        )}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center rounded-lg px-3" style={inputStyle}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>$</span>
            <input
              type="number"
              min="0"
              step="1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="No limit"
              className="flex-1 bg-transparent px-1 py-2 text-sm outline-none"
            />
          </div>
          <button onClick={onSave} disabled={saving} className="rounded-lg px-3 text-sm disabled:opacity-40" style={{ background: 'var(--accent)', color: 'white' }}>
            Save
          </button>
        </div>
        {error && <div className="text-xs" style={{ color: 'var(--error)' }}>{error}</div>}
      </div>
    </section>
  );
}
