import { z } from 'zod';

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
