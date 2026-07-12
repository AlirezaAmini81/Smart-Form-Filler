import type { ProviderRuntimeConfig } from '../config/llmConfig'
import { LlmError } from './errors'
import type { LlmProvider } from './provider'
import { PROVIDER_CATALOG, PROVIDER_IDS, type ProviderId } from './providerCatalog'
import type { LlmProviderMode, LlmProviderStatusMap } from './types'
import { createAnthropicProvider } from './anthropicProvider'
import { createMistralProvider } from './mistralProvider'
import { createOllamaProvider } from './ollamaProvider'
import { createOpenAiProvider } from './openaiProvider'

export interface LlmProviderRegistry {
  getProvider(providerId: ProviderId): LlmProvider
  listProviders(): LlmProvider[]
  getProviderStatuses(): Promise<LlmProviderStatusMap>
}

export function getProviderMode(providerId: ProviderId): LlmProviderMode {
  const entry = PROVIDER_CATALOG[providerId]
  if (!entry) throw new LlmError('UNKNOWN_PROVIDER', `Unknown provider: ${String(providerId)}`)
  return entry.mode
}

export function createProviderRegistry(configs: Record<ProviderId, ProviderRuntimeConfig>): LlmProviderRegistry {
  const providers: Record<ProviderId, LlmProvider> = {
    openai: createOpenAiProvider(configs.openai),
    anthropic: createAnthropicProvider(configs.anthropic),
    mistral: createMistralProvider(configs.mistral),
    ollama: createOllamaProvider(configs.ollama)
  }
  return {
    getProvider(providerId) {
      const provider = providers[providerId]
      if (!provider) throw new LlmError('UNKNOWN_PROVIDER', `Unknown provider: ${String(providerId)}`)
      return provider
    },
    listProviders: () => PROVIDER_IDS.map((id) => providers[id]),
    async getProviderStatuses() {
      return Object.fromEntries(await Promise.all(PROVIDER_IDS.map(async (id) => {
        try { return [id, await providers[id].testConnection()] as const }
        catch (error) { return [id, { available: false, label: providers[id].label, details: error instanceof Error ? error.message : 'Status check failed.' }] as const }
      }))) as LlmProviderStatusMap
    }
  }
}
