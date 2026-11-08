'use client';

import { useCallback, useEffect, useState } from 'react';
import { useChat, type StoredUiMessage } from '@/hooks/use-chat';
import { MessageList } from '@/components/message-list';
import { ChatInput } from '@/components/chat-input';
import { ModelSelector, type SelectableModel } from '@/components/model-selector';
import { Sidebar } from '@/components/sidebar';
import { SettingsPanel } from '@/components/settings-panel';

interface ConversationSummary {
  id: string;
  title: string | null;
  modelPolicy: string;
  messageCount: number;
  updatedAt: string;
}

export default function ChatPage() {
  const [modelPolicy, setModelPolicy] = useState('auto');
  const [toolsOn, setToolsOn] = useState(true);
  const [models, setModels] = useState<SelectableModel[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      const body = (await res.json()) as { models: SelectableModel[]; webSearch: boolean };
      setModels(body.models);
      setWebSearch(body.webSearch);
      return body.models;
    } catch {
      return [];
    } finally {
      setModelsLoaded(true);
    }
  }, []);

  const loadConversations = useCallback(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadModels().then((list) => {
      if (list.length === 0) setSettingsOpen(true);
    });
    loadConversations();
  }, [loadModels, loadConversations]);

  // A pinned model that was disabled in Settings falls back to Auto.
  useEffect(() => {
    if (modelsLoaded && !modelPolicy.startsWith('auto') && !models.some((m) => m.routerId === modelPolicy)) {
      setModelPolicy('auto');
    }
  }, [models, modelsLoaded, modelPolicy]);

  const { messages, isLoading, sendMessage, stop, reset, load } = useChat({
    modelPolicy,
    tools: toolsOn,
    onConversationCreated: (id) => {
      setActiveConvId(id);
      loadConversations();
    },
    onFinished: loadConversations,
  });

  const handleNewChat = () => {
    setActiveConvId(undefined);
    reset();
  };

  const handleSelect = async (id: string) => {
    const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const conv = (await res.json()) as { id: string; modelPolicy: string; messages: StoredUiMessage[] };
    setActiveConvId(conv.id);
    setModelPolicy(conv.modelPolicy);
    load(conv.id, conv.messages);
  };

  const handleDeleteConv = async (id: string) => {
    await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (activeConvId === id) handleNewChat();
    loadConversations();
  };

  const hasModels = models.length > 0;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelect}
        onNew={handleNewChat}
        onDelete={handleDeleteConv}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="h-14 px-6 flex items-center justify-between shrink-0 gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <ModelSelector value={modelPolicy} onChange={setModelPolicy} models={models} />
            <button
              onClick={() => setToolsOn(!toolsOn)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: toolsOn ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                color: toolsOn ? 'var(--accent-hover)' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              title={
                webSearch
                  ? 'Let models search the web, read pages and check the date'
                  : 'Web search is not configured on the server (TAVILY_API_KEY). Page reading and date still work.'
              }
            >
              🔎 Tools {toolsOn ? 'on' : 'off'}
              {toolsOn && !webSearch && ' (no search)'}
            </button>
          </div>
          {modelsLoaded && !hasModels && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}
            >
              <span>⚠️</span>
              <span>Add an API key</span>
            </button>
          )}
        </div>

        <MessageList messages={messages} hasKeys={hasModels} />

        <ChatInput onSend={sendMessage} onStop={stop} isLoading={isLoading} disabled={!hasModels} />
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => void loadModels()}
      />
    </div>
  );
}
