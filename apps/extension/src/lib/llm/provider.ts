import type { SuggestionGenerationInput } from '../../features/suggestions/suggestionTypes'
import type { LlmProviderId, LlmProviderMode, LlmProviderResponse, LlmProviderStatus } from './types'

export interface LlmProvider {
  readonly id: LlmProviderId
  readonly label: string
  readonly mode: LlmProviderMode
  testConnection(): Promise<LlmProviderStatus>
  generateFieldSuggestions(input: SuggestionGenerationInput): Promise<LlmProviderResponse>
}
