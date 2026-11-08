import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Docs · OmniRouter',
  description: 'How to set up OmniRouter: API keys, models, Auto mode, tools and using it from other apps.',
};

const SECTIONS = [
  { id: 'start', title: 'Getting started' },
  { id: 'keys', title: 'Getting an API key' },
  { id: 'models', title: 'Choosing models' },
  { id: 'auto', title: 'Auto mode' },
  { id: 'failover', title: 'When a provider fails' },
  { id: 'tools', title: 'Web search and tools' },
  { id: 'limits', title: 'Spending limit' },
  { id: 'apps', title: 'Use from Cursor and other apps' },
  { id: 'privacy', title: 'Security and privacy' },
  { id: 'trouble', title: 'Troubleshooting' },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <header className="h-14 px-6 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <Link href="/" className="text-sm font-semibold">OmniRouter</Link>
        <Link
          href="/"
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          Open chat
        </Link>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 flex gap-10">
        <nav className="hidden md:block w-52 shrink-0">
          <div className="sticky top-6 space-y-1">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block text-sm px-2 py-1 rounded hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                {s.title}
              </a>
            ))}
          </div>
        </nav>

        <main className="flex-1 min-w-0 prose text-sm space-y-12">
          <div>
            <h1 className="text-2xl">Documentation</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              OmniRouter lets you chat with Claude, GPT, Gemini and other models using your own API keys. When one
              provider hits its limit or goes down, another model continues the conversation.
            </p>
          </div>

          <Section id="start" title="Getting started">
            <Steps
              items={[
                'Open the chat and click Settings in the bottom-left corner.',
                'Pick a provider, paste your API key, and click "Verify key & detect models". We check the key with the provider and list every model it can use.',
                'Tick the models you want the router to use. Models we have price and quality data for are ticked automatically.',
                'Close Settings, choose Auto (or a specific model) at the top, and start chatting.',
              ]}
            />
            <p>
              You can use the site as a guest. Sign in with Google to keep your keys and chats on every device. Anything
              you added as a guest moves into your account when you sign in.
            </p>
            <Note>Adding keys from two or more providers is what makes failover work. One key means no backup.</Note>
          </Section>

          <Section id="keys" title="Getting an API key">
            <p>
              An API key is a password that lets this site call a model on your behalf. Usage is billed to your provider
              account, not to us.
            </p>
            <Table
              head={['Provider', 'Where to get a key', 'Notes']}
              rows={[
                ['Anthropic (Claude)', <A key="a" href="https://console.anthropic.com/settings/keys">console.anthropic.com</A>, 'Needs a small prepaid balance.'],
                ['OpenAI (GPT)', <A key="o" href="https://platform.openai.com/api-keys">platform.openai.com</A>, 'Needs a payment method or credits.'],
                ['Google (Gemini)', <A key="g" href="https://aistudio.google.com/apikey">aistudio.google.com</A>, 'Has a free tier. Free-tier prompts may be used by Google to improve its models.'],
                ['OpenRouter', <A key="r" href="https://openrouter.ai/keys">openrouter.ai/keys</A>, 'Choose "OpenAI-compatible". Base URL: https://openrouter.ai/api/v1'],
                ['Groq', <A key="q" href="https://console.groq.com/keys">console.groq.com</A>, 'Choose "OpenAI-compatible". Base URL: https://api.groq.com/openai/v1'],
              ]}
            />
            <p>
              Any other service that speaks the OpenAI API format works the same way: choose OpenAI-compatible, paste
              its base URL and key. If the service cannot list its models, type the model id in the optional field.
            </p>
          </Section>

          <Section id="models" title="Choosing models">
            <p>
              Each key shows its own list of models. Open a key in Settings to tick or untick models, filter the list,
              re-check for new models, or add a model id by hand.
            </p>
            <ul>
              <li><b>rated</b> means we have quality and price data for the model, so Auto can rank it well.</li>
              <li><b>price unknown</b> means the model works, but its cost is not counted in your spending total.</li>
              <li><b>no tools</b> means the model cannot use web search. It is skipped while Tools is on.</li>
            </ul>
            <Note>
              Untick models that are not chat models, such as embedding, moderation or &quot;guard&quot; models. They
              cannot answer messages.
            </Note>
          </Section>

          <Section id="auto" title="Auto mode">
            <Table
              head={['Option', 'What it does']}
              rows={[
                ['Auto', 'Picks a model for each message based on the type of task, quality, cost and recent reliability.'],
                ['Auto (cheap)', 'Leans toward the lowest-cost models.'],
                ['Auto (fast)', 'Leans toward models that have been responding fastest.'],
                ['A specific model', 'Always uses that model first, and still falls back to another if it fails.'],
              ]}
            />
            <p>
              Click &quot;why this model?&quot; above any reply to see the reason and the backup models lined up for it.
              Auto chooses best among rated models. With only unrated models it has little to go on, so it tends to pick
              the same one.
            </p>
          </Section>

          <Section id="failover" title="When a provider fails">
            <ul>
              <li>If a model fails before writing anything, the next model answers. You will not notice.</li>
              <li>
                If it fails halfway through a reply, the next model continues from where it stopped and the reply is
                marked &quot;switched model&quot;.
              </li>
              <li>A model that hits a rate limit is paused for a short time, so later messages skip it.</li>
              <li>An invalid key stops the request with an error instead of silently trying others.</li>
            </ul>
            <Note>
              This gives you more total capacity across your keys. Each provider&apos;s own limits and billing still apply.
            </Note>
          </Section>

          <Section id="tools" title="Web search and tools">
            <p>
              With Tools on, models can search the web, read a page you link, and check today&apos;s date. This helps with
              questions about recent events that are past a model&apos;s training cutoff. Searches appear above the reply.
            </p>
            <p>Turn Tools off for faster, cheaper replies when you don&apos;t need anything current.</p>
          </Section>

          <Section id="limits" title="Spending limit">
            <p>
              Settings shows an estimate of what you have spent this month. Set a monthly limit and chats stop once the
              estimate reaches it. Leave the box empty for no limit.
            </p>
            <p>
              Estimates use public list prices and skip models marked price unknown. Your provider&apos;s dashboard is the
              real bill.
            </p>
          </Section>

          <Section id="apps" title="Use from Cursor and other apps">
            <p>The router also works as an OpenAI-compatible API, so any app with a custom OpenAI endpoint can use it.</p>
            <Steps
              items={[
                'In Settings, under "Use from other apps", click Create router key and copy it. It is shown only once.',
                'In your app, set the OpenAI base URL to this site followed by /v1.',
                'Paste the router key as the API key, and set the model to auto or a model id such as google/gemini-3.5-flash.',
              ]}
            />
            <pre><code>{`curl https://YOUR-SITE/v1/chat/completions \\
  -H "Authorization: Bearer sk-router-..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'`}</code></pre>
            <p>Revoke a router key in Settings at any time. Requests made with it count toward your spending limit.</p>
          </Section>

          <Section id="privacy" title="Security and privacy">
            <ul>
              <li>Your API keys are encrypted before they are stored and are never sent back to the browser.</li>
              <li>Only the last four characters of a key are shown, so you can tell keys apart.</li>
              <li>Your messages are sent to the provider of the model that answers, under that provider&apos;s policies.</li>
              <li>Deleting a key or a chat removes it from our database.</li>
            </ul>
          </Section>

          <Section id="trouble" title="Troubleshooting">
            <Faq q='"The provider rejected this API key"'>
              The key is wrong, revoked, or the account has no credit. Create a new key with your provider and add it again.
            </Faq>
            <Faq q='"No models enabled"'>Open Settings, expand your key, and tick at least one model.</Faq>
            <Faq q='"All providers are rate-limited right now"'>
              Every enabled model hit its limit. Wait a minute, or add a key from another provider.
            </Faq>
            <Faq q="A model says it is not available for new users">
              The provider has retired that model for new accounts. Untick it in Settings and use a newer one.
            </Faq>
            <Faq q='"Too many requests"'>
              You are sending messages faster than the site allows. Wait the number of seconds shown and try again.
            </Faq>
            <Faq q='"Monthly spending limit reached"'>Raise or remove the limit in Settings.</Faq>
          </Section>
        </main>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-lg">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol>
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ol>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-4 py-3 my-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
      {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{q}</p>
      <p style={{ color: 'var(--text-secondary)' }}>{children}</p>
    </div>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
