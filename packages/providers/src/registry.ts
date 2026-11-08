import type { Provider } from '@omnirouter/canonical';
import type { ProviderAdapter } from './types.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAiAdapter, OpenAiCompatibleAdapter } from './openai.js';
import { GoogleAdapter } from './google.js';

/**
 * The registry is the only place adapters are constructed. Everything else
 * asks for one by provider id.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<Provider, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[] = defaultAdapters()) {
    for (const adapter of adapters) this.adapters.set(adapter.id, adapter);
  }

  get(provider: Provider): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`no adapter registered for provider "${provider}"`);
    return adapter;
  }

  has(provider: Provider): boolean {
    return this.adapters.has(provider);
  }

  all(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}

export function defaultAdapters(): ProviderAdapter[] {
  return [
    new AnthropicAdapter(),
    new OpenAiAdapter(),
    new GoogleAdapter(),
    new OpenAiCompatibleAdapter(),
  ];
}

/** Process-wide registry. Tests construct their own. */
export const registry = new AdapterRegistry();
