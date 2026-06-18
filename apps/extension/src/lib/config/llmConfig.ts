import type { LlmProviderId } from '../../features/suggestions/suggestionTypes'

export interface LlmConfig {
  activeProviderId: LlmProviderId
  requestLimits: {
    maxKnowledgeSnippets: number
    maxFieldsPerRequest: number
  }
  ollama: {
    endpoint: string
    model: string
    timeoutMs: number
  }
  openai: {
    proxyUrl: string
    timeoutMs: number
    cloudEnabled: boolean
  }
}

export type LlmConfigUpdate = Partial<LlmConfig> & {
  requestLimits?: Partial<LlmConfig['requestLimits']>
  ollama?: Partial<LlmConfig['ollama']>
  openai?: Partial<LlmConfig['openai']>
}

const DEFAULT_LLM_CONFIG: LlmConfig = {
  activeProviderId: 'ollama',
  requestLimits: {
    maxKnowledgeSnippets: 6,
    maxFieldsPerRequest: 25
  },
  ollama: {
    endpoint: 'http://localhost:11434',
    model: 'llama3.2:3b',
    timeoutMs: 200000
  },
  openai: {
    proxyUrl: 'http://localhost:8787',
    timeoutMs: 200000,
    cloudEnabled: false
  }
}

let cachedConfig: LlmConfig = { ...DEFAULT_LLM_CONFIG }

export function getDefaultLlmConfig(): LlmConfig {
  return { ...DEFAULT_LLM_CONFIG, requestLimits: { ...DEFAULT_LLM_CONFIG.requestLimits } }
}

export function getLlmConfig(): LlmConfig {
  return {
    ...cachedConfig,
    requestLimits: { ...cachedConfig.requestLimits },
    ollama: { ...cachedConfig.ollama },
    openai: { ...cachedConfig.openai }
  }
}

export function mergeLlmConfig(base: LlmConfig, overrides: LlmConfigUpdate): LlmConfig {
  return {
    ...base,
    ...overrides,
    requestLimits: {
      ...base.requestLimits,
      ...overrides.requestLimits
    },
    ollama: {
      ...base.ollama,
      ...overrides.ollama
    },
    openai: {
      ...base.openai,
      ...overrides.openai
    }
  }
}

export function updateLlmConfig(update: LlmConfigUpdate): LlmConfig {
  cachedConfig = mergeLlmConfig(cachedConfig, update)
  return getLlmConfig()
}
