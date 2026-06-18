import type { SuggestionGenerationInput } from '../../features/suggestions/suggestionTypes'
import type { LlmProviderId, LlmProviderMode, LlmProviderResponse, LlmProviderStatus } from './types'

export interface LlmProvider {
  id: LlmProviderId
  label: string
  mode: LlmProviderMode
  getStatus(): Promise<LlmProviderStatus>
  generateFieldSuggestions(input: SuggestionGenerationInput): Promise<LlmProviderResponse>
}
