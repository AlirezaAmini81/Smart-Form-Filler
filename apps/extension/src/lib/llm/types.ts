import type {
  LlmProviderId,
  LlmProviderMode,
  SuggestionGenerationInput,
  SuggestionGenerationResponse
} from '../../features/suggestions/suggestionTypes'

export type { LlmProviderId, LlmProviderMode }

export interface LlmProviderStatus {
  available: boolean
  label: string
  details?: string
  model?: string
}

export type LlmProviderStatusMap = Record<LlmProviderId, LlmProviderStatus>

export interface LlmProviderResponse {
  response: SuggestionGenerationResponse
  rawText?: string
  model?: string
}

export interface PromptSections {
  system: string
  trustedKnowledge: string
  untrustedForm: string
  outputSchema: string
  user: string
  fullPrompt: string
  schemaVersion: string
}

export type { SuggestionGenerationInput }
