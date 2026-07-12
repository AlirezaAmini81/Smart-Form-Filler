import { z } from 'zod'

export const ProviderIdSchema = z.enum(['openai', 'anthropic', 'mistral', 'ollama'])
export type ProviderId = z.infer<typeof ProviderIdSchema>

export type ProviderCatalogEntry = {
  id: ProviderId
  name: string
  defaultModel: string
  models: ReadonlyArray<{ id: string; label: string }>
  apiOrigin: string | null
  credentialRequired: boolean
  mode: 'cloud' | 'local'
}

export const PROVIDER_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-5-mini',
    models: [
      { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' }
    ],
    apiOrigin: 'https://api.openai.com',
    credentialRequired: true,
    mode: 'cloud'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    defaultModel: 'claude-haiku-4-5',
    models: [
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }
    ],
    apiOrigin: 'https://api.anthropic.com',
    credentialRequired: true,
    mode: 'cloud'
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    defaultModel: 'mistral-small-latest',
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small (latest)' },
      { id: 'ministral-3b-2512', label: 'Ministral 3 3B' },
      { id: 'ministral-8b-2512', label: 'Ministral 3 8B' }
    ],
    apiOrigin: 'https://api.mistral.ai',
    credentialRequired: true,
    mode: 'cloud'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    defaultModel: 'llama3.2:3b',
    models: [
      { id: 'llama3.2:1b', label: 'Llama 3.2 1B' },
      { id: 'llama3.2:3b', label: 'Llama 3.2 3B' },
      { id: 'gemma3:1b', label: 'Gemma 3 1B' },
      { id: 'gemma3:4b', label: 'Gemma 3 4B' }
    ],
    apiOrigin: null,
    credentialRequired: false,
    mode: 'local'
  }
}

export const PROVIDER_IDS = ProviderIdSchema.options

export function providerOriginPattern(provider: ProviderId, ollamaEndpoint?: string): string {
  const fixedOrigin = PROVIDER_CATALOG[provider].apiOrigin
  if (fixedOrigin) return `${fixedOrigin}/*`
  const url = validateOllamaEndpoint(ollamaEndpoint ?? 'http://localhost:11434')
  return `${url.protocol}//${url.hostname}/*`
}

export function validateOllamaEndpoint(value: string): URL {
  const url = new URL(value)
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!['http:', 'https:'].includes(url.protocol) || !localHosts.has(url.hostname)) {
    throw new Error('Ollama endpoint must use localhost or a loopback address.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Ollama endpoint must not contain credentials, query parameters, or fragments.')
  }
  return url
}
