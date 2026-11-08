'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { signInWithGoogle, signOut } from '@/lib/auth-client';

interface Conversation {
  id: string;
  title: string | null;
  modelPolicy: string;
  messageCount: number;
  updatedAt: string;
}

interface SidebarProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  me: Me | null;
  /** Mobile only: whether the drawer is open. Always visible on md+ screens. */
  open: boolean;
  onClose: () => void;
}

export interface Me {
  user: { name: string; email: string; image: string | null } | null;
  loginAvailable: boolean;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
  me,
  open,
  onClose,
}: SidebarProps) {
  return (
    <>
    {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={onClose} />}
    <div
      className={cn(
        'fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] h-full flex flex-col shrink-0 transition-transform duration-200',
        'md:static md:z-auto md:w-64 md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
      style={{
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div className="p-4 flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          OmniRouter
        </span>
        <div className="flex items-center gap-1">
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center md:hidden"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Close menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
        <button
          onClick={onNew}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          title="New chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              No conversations yet
            </p>
          </div>
        ) : (
          conversations.map(conv => (
            <div key={conv.id} className="group relative">
              <button
                onClick={() => onSelect(conv.id)}
                className="w-full text-left pl-3 pr-9 py-2.5 md:py-2 rounded-lg text-sm transition-colors truncate"
                style={{
                  background: activeId === conv.id ? 'var(--bg-hover)' : 'transparent',
                  color: activeId === conv.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                onMouseEnter={(e) => {
                  if (activeId !== conv.id) e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  if (activeId !== conv.id) e.currentTarget.style.background = 'transparent';
                }}
              >
                {conv.title ?? 'New chat'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 md:w-6 md:h-6 rounded flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--error)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                title="Delete"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="p-3 space-y-1" style={{ borderTop: '1px solid var(--border)' }}>
        <AccountBox me={me} />
        <a
          href="/docs"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          Docs
        </a>
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
          <span>Settings</span>
        </button>
      </div>
    </div>
    </>
  );
}


function AccountBox({ me }: { me: Me | null }) {
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  if (me.user) {
    const initial = (me.user.name || me.user.email).charAt(0).toUpperCase();
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
        {me.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.user.image} alt="" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full shrink-0" />
        ) : (
          <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
            {initial}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{me.user.name}</div>
          <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{me.user.email}</div>
        </div>
        <button
          onClick={() => { setBusy(true); void signOut(); }}
          disabled={busy}
          className="text-[11px] px-2 py-1 rounded hover:opacity-80"
          style={{ color: 'var(--text-secondary)' }}
        >
          Log out
        </button>
      </div>
    );
  }

  if (!me.loginAvailable) {
    return (
      <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Guest mode
      </div>
    );
  }

  return (
    <div className="px-1 pb-1">
      <button
        onClick={() => { setBusy(true); void signInWithGoogle().catch(() => setBusy(false)); }}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
        style={{ background: 'white', color: '#1f1f1f' }}
      >
        <GoogleIcon />
        {busy ? 'Redirecting…' : 'Sign in with Google'}
      </button>
      <div className="text-[11px] mt-1.5 px-1 text-center" style={{ color: 'var(--text-muted)' }}>
        You&apos;re a guest. Sign in to keep your keys and chats on every device.
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
