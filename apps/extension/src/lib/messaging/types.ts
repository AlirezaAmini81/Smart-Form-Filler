import type {
  GenerateSuggestionsForPageInput,
  LlmProviderId,
  PrivacyMode,
  SuggestionGenerationResult
} from '../../features/suggestions/suggestionTypes'
import type { LlmProviderStatus, LlmProviderStatusMap } from '../llm/types'
import type { SerializableLlmError } from '../llm/errors'

export type GenerateFieldSuggestionsRequest = {
  type: 'GENERATE_FIELD_SUGGESTIONS'
  payload: GenerateSuggestionsForPageInput
}

export type GetProviderStatusRequest = {
  type: 'GET_LLM_PROVIDER_STATUS'
  payload?: {
    providerId?: LlmProviderId
    privacyMode?: PrivacyMode
  }
}

export type BackgroundRequest = GenerateFieldSuggestionsRequest | GetProviderStatusRequest

export type GenerateFieldSuggestionsResponse =
  | { ok: true; result: SuggestionGenerationResult }
  | { ok: false; error: SerializableLlmError }

export type ProviderStatusResponse =
  | { ok: true; status: LlmProviderStatus | LlmProviderStatusMap }
  | { ok: false; error: SerializableLlmError }

export type BackgroundResponse = GenerateFieldSuggestionsResponse | ProviderStatusResponse
