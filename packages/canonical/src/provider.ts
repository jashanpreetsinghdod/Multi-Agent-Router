import { z } from 'zod';

/**
 * A provider is an upstream LLM API. `compatible` covers any endpoint that
 * speaks the OpenAI wire format (OpenRouter, Groq, vLLM, LM Studio, Ollama's
 * OpenAI shim). Users can register their own base URL for it.
 */
export const ProviderSchema = z.enum([
  'anthropic',
  'openai',
  'google',
  'compatible',
]);

export type Provider = z.infer<typeof ProviderSchema>;

export const PROVIDERS: readonly Provider[] = [
  'anthropic',
  'openai',
  'google',
  'compatible',
] as const;

const DISPLAY_NAMES: Record<Provider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  compatible: 'OpenAI-compatible',
};

export function providerDisplayName(provider: Provider): string {
  return DISPLAY_NAMES[provider];
}
