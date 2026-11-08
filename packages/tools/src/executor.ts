import { safeFetch, validateSafeUrl } from './ssrf.js';

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

export type ToolExecutor = (input: Record<string, unknown>) => Promise<ToolExecutionResult>;

export function executeGetCurrentTime(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const timezone = typeof input.timezone === 'string' ? input.timezone : 'UTC';
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'long',
    });
    return Promise.resolve({
      content: JSON.stringify({
        iso: now.toISOString(),
        formatted: formatter.format(now),
        timezone,
      }),
    });
  } catch (err) {
    return Promise.resolve({
      isError: true,
      content: `Invalid timezone '${timezone}': ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export async function executeFetchUrl(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const url = typeof input.url === 'string' ? input.url : '';
  if (!url) {
    return { isError: true, content: 'Missing required parameter: url' };
  }

  const check = validateSafeUrl(url);
  if (!check.safe) {
    return { isError: true, content: `SSRF Guard blocked request: ${check.reason}` };
  }

  const maxLength = typeof input.maxLength === 'number'
    ? Math.min(Math.max(100, input.maxLength), 20000)
    : 8000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    // safeFetch re-checks DNS resolution and every redirect hop.
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OmniRouter-Bot/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      return {
        isError: true,
        content: `HTTP fetch failed with status ${res.status} ${res.statusText}`,
      };
    }

    const text = await readCapped(res, MAX_FETCH_BYTES);
    // Simple tag stripping to reduce token consumption
    const cleanText = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const truncated = cleanText.length > maxLength
      ? cleanText.slice(0, maxLength) + '\n... [content truncated]'
      : cleanText;

    return { content: truncated };
  } catch (err) {
    return {
      isError: true,
      content: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

const MAX_FETCH_BYTES = 2_000_000;

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (received >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return out + decoder.decode();
}

export async function executeWebSearch(
  input: Record<string, unknown>,
  apiKey?: string,
): Promise<ToolExecutionResult> {
  const query = typeof input.query === 'string' ? input.query : '';
  if (!query) {
    return { isError: true, content: 'Missing required parameter: query' };
  }
  const maxResults = typeof input.maxResults === 'number'
    ? Math.min(Math.max(1, input.maxResults), 10)
    : 5;

  const tavilyKey = apiKey ?? process.env.TAVILY_API_KEY;

  if (tavilyKey) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          max_results: maxResults,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { results?: Array<{ title: string; url: string; content: string }> };
        const items = (data.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        }));
        return { content: JSON.stringify(items, null, 2) };
      }
      return { isError: true, content: `Search provider returned HTTP ${res.status}` };
    } catch (err) {
      return {
        isError: true,
        content: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // No key: say so plainly. Fake "results" would invite the model to cite them.
  return {
    isError: true,
    content:
      'Web search is not configured on this server (TAVILY_API_KEY is unset). ' +
      'Tell the user live search is unavailable and answer from your own knowledge, noting its cutoff.',
  };
}

export function webSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export class ToolRegistry {
  private executors = new Map<string, ToolExecutor>();

  constructor() {
    this.register('get_current_time', executeGetCurrentTime);
    this.register('fetch_url', executeFetchUrl);
    this.register('web_search', (input) => executeWebSearch(input));
  }

  register(name: string, executor: ToolExecutor): void {
    this.executors.set(name, executor);
  }

  has(name: string): boolean {
    return this.executors.has(name);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const executor = this.executors.get(name);
    if (!executor) {
      return { isError: true, content: `Unknown tool: ${name}` };
    }
    return executor(input);
  }
}

