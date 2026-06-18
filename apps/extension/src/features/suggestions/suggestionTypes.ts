import type {
  FormFieldMetadata,
  SuggestedFieldValue,
  SuggestionConfidence,
  SuggestionSensitivity,
  SuggestionValueType
} from '../../../../../packages/shared/src/schemas'

export type { SuggestionConfidence, SuggestionSensitivity, SuggestionValueType }

export type LlmProviderId = 'ollama' | 'openai'
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

export interface ActiveProfile {
  id: string
  name: string
  sensitivity: SuggestionSensitivity
}

export interface SuggestionField {
  id: string
  name?: string
  label?: string
  placeholder?: string
  ariaLabel?: string
  type?: string
  kind: FormFieldKind
}

export interface RetrievedKnowledgeSnippet {
  id: string
  profileId: string
  label: string
  value?: string
  summary?: string
  tags?: string[]
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
    mode: LlmProviderMode
    model?: string
  }
  warnings: SuggestionWarning[]
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
}
