import type { LlmConfig } from '../config/llmConfig'
import { LlmError } from './errors'
import type { LlmProvider } from './provider'
import type { LlmProviderId, LlmProviderMode, LlmProviderStatusMap } from './types'
import { createOllamaProvider } from './ollamaProvider'
import { createOpenAiProvider } from './openaiProvider'

export interface LlmProviderRegistry {
  getProvider(providerId: LlmProviderId): LlmProvider
  listProviders(): LlmProvider[]
  getProviderStatuses(): Promise<LlmProviderStatusMap>
}

export function getProviderMode(providerId: LlmProviderId): LlmProviderMode {
  switch (providerId) {
    case 'openai':
      return 'cloud'
    case 'ollama':
    default:
      return 'local'
  }
}

export function createProviderRegistry(config: LlmConfig): LlmProviderRegistry {
  const providers: Record<LlmProviderId, LlmProvider> = {
    ollama: createOllamaProvider(config),
    openai: createOpenAiProvider(config)
  }

  return {
    getProvider(providerId) {
      const provider = providers[providerId]
      if (!provider) {
        throw new LlmError('UNKNOWN_PROVIDER', `Unknown provider: ${providerId}`)
      }

      if (providerId === 'openai' && !config.openai.cloudEnabled) {
        throw new LlmError('CLOUD_MODE_DISABLED', 'Cloud mode is disabled by default.')
      }

      return provider
    },
    listProviders() {
      return Object.values(providers)
    },
    async getProviderStatuses() {
      const entries = await Promise.all(
        (Object.keys(providers) as LlmProviderId[]).map(async (id) => {
          const provider = providers[id]
          try {
            const status = await provider.getStatus()
            return [id, status] as const
          } catch (error) {
            return [
              id,
              {
                available: false,
                label: provider.label,
                details: error instanceof Error ? error.message : 'Status check failed.'
              }
            ] as const
          }
        })
      )

      return entries.reduce((acc, [id, status]) => {
        acc[id] = status
        return acc
      }, {} as LlmProviderStatusMap)
    }
  }
}
