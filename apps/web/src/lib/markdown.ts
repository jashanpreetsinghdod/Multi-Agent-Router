import { Marked } from 'marked';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(href: string): string | null {
  try {
    const url = new URL(href, 'https://placeholder.invalid');
    if (url.origin === 'https://placeholder.invalid') return null; // relative links: drop
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (!safe) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(safe)}"${t} target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`;
    },
    image({ href, text }) {
      const safe = safeHref(href);
      const label = escapeHtml(text || 'image');
      if (!safe) return label;
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer nofollow">[${label}]</a>`;
    },
  },
});

export function renderMarkdown(src: string): string {
  return marked.parse(src) as string;
}
