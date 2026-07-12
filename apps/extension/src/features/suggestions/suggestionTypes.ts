import type {
  FormFieldMetadata,
  SuggestedFieldValue,
  SuggestionConfidence,
  SuggestionMode,
  SuggestionSensitivity,
  SuggestionValueType
} from '../../../../../packages/shared/src/schemas'
import type { ProfileMetadata } from './knowledgeTypes'
import type { ProviderId } from '../../lib/llm/providerCatalog'

export type { SuggestionConfidence, SuggestionSensitivity, SuggestionValueType }
export type { SuggestionMode }

export type LlmProviderId = ProviderId
export type LlmProviderMode = 'local' | 'cloud'
export type PrivacyMode = 'local-only' | 'cloud-opt-in'

export type FormFieldInput = FormFieldMetadata
export type FormFieldKind = FormFieldMetadata['kind']

export interface PageContext {
  url: string
  title: string
  hostname?: string
  language?: string
}

export type ActiveProfile = ProfileMetadata

export interface SuggestionField {
  id: string
  locator?: string
  name?: string
  label?: string
  placeholder?: string
  ariaLabel?: string
  autocomplete?: string
  title?: string
  inputMode?: string
  type?: string
  value?: string
  options?: string[]
  kind: FormFieldKind
}

export interface RetrievedKnowledgeSnippet {
  id: string
  profileId: string
  label: string
  value?: string
  summary?: string
  tags?: string[]
  aliases?: string[]
  sourceId: string
  sourceLabel?: string
  sensitivity: SuggestionSensitivity
  score: number
}

export interface SuggestionWarning {
  code: string
  message: string
  fieldId?: string
}

export interface SuggestionGenerationInput {
  pageContext: PageContext
  activeProfile: ActiveProfile
  fields: SuggestionField[]
  knowledgeSnippets: RetrievedKnowledgeSnippet[]
  privacyMode: PrivacyMode
  providerId: LlmProviderId
  suggestionMode: Exclude<SuggestionMode, 'deterministic-only'>
  injectionWarnings?: SuggestionWarning[]
}

export interface ProviderSuggestion {
  fieldId: string
  suggestedValue: string | null
  valueType: SuggestionValueType
  confidence: SuggestionConfidence
  reasoningSummary: string
  knowledgeEntryIds: string[]
  sourceIds: string[]
  sensitivity: SuggestionSensitivity
  requiresUserConfirmation: boolean
  warnings: string[]
}

export interface SuggestionGenerationResponse {
  suggestions: ProviderSuggestion[]
  warnings: string[]
}

export interface SuggestionGenerationResult {
  suggestions: SuggestedFieldValue[]
  provider: {
    id: LlmProviderId
    mode: LlmProviderMode | 'none'
    model?: string
  }
  warnings: SuggestionWarning[]
  debug?: {
    rawOutput?: string
    parsedResponse?: SuggestionGenerationResponse
    minimizedFields?: SuggestionField[]
    minimizedSnippets?: RetrievedKnowledgeSnippet[]
  }
  metadata: {
    generatedAt: string
    activeProfileId: string
    fieldsReceived: number
    suggestionsReturned: number
    knowledgeSnippetsUsed: number
  }
}

export interface GenerateSuggestionsForPageInput {
  pageContext: PageContext
  fields: FormFieldInput[]
  activeProfileId: string
  providerId: LlmProviderId
  privacyMode: PrivacyMode
  suggestionMode: SuggestionMode
}
