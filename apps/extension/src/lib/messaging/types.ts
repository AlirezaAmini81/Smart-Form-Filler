import type { GenerateSuggestionsForPageInput, SuggestionGenerationResult } from '../../features/suggestions/suggestionTypes'
import type { CredentialPersistence, CredentialStatus } from '../../features/providers/providerCredentialStore'
import type { ProviderId } from '../llm/providerCatalog'
import type { LlmProviderStatus } from '../llm/types'
import type { SerializableLlmError } from '../llm/errors'

export type BackgroundRequest =
  | { type: 'GENERATE_FIELD_SUGGESTIONS'; payload: GenerateSuggestionsForPageInput }
  | { type: 'GET_LLM_PROVIDER_STATUS'; payload: { providerId: ProviderId } }
  | { type: 'GET_PROVIDER_CREDENTIAL_STATUS'; payload: { providerId: ProviderId } }
  | { type: 'SAVE_PROVIDER_CREDENTIAL'; payload: { providerId: ProviderId; apiKey: string; persistence: CredentialPersistence } }
  | { type: 'DELETE_PROVIDER_CREDENTIAL'; payload: { providerId: ProviderId } }
  | { type: 'PREPARE_PROVIDER_CREDENTIAL_REKEY' }
  | { type: 'COMPLETE_PROVIDER_CREDENTIAL_REKEY' }

export type GenerateFieldSuggestionsResponse =
  | { ok: true; result: SuggestionGenerationResult }
  | { ok: false; error: SerializableLlmError }

export type ProviderStatusResponse =
  | { ok: true; status: LlmProviderStatus }
  | { ok: false; error: SerializableLlmError }

export type CredentialStatusResponse =
  | { ok: true; status: CredentialStatus }
  | { ok: false; error: SerializableLlmError }

export type CredentialMutationResponse = { ok: true } | { ok: false; error: SerializableLlmError }

export type BackgroundResponse = GenerateFieldSuggestionsResponse | ProviderStatusResponse | CredentialStatusResponse | CredentialMutationResponse
