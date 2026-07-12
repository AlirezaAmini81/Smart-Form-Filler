import { getProviderMode } from '../../lib/llm/providerRegistry'
import { LlmError } from '../../lib/llm/errors'
import { minimizeFields, minimizeKnowledgeSnippets } from '../../lib/privacy/dataMinimization'
import { runPromptInjectionGuards } from '../../lib/privacy/promptInjectionGuards'
import { applySensitiveDataPolicy } from '../../lib/privacy/sensitiveDataPolicy'
import type { LlmProviderRegistry } from '../../lib/llm/providerRegistry'
import type { LlmProviderResponse } from '../../lib/llm/types'
import type {
  GenerateSuggestionsForPageInput,
  RetrievedKnowledgeSnippet,
  SuggestionField,
  SuggestionGenerationResult
} from './suggestionTypes'
import { createDefaultKnowledgeRetriever } from './knowledgeRetriever'
import type { KnowledgeRetriever } from './knowledgeRetriever'
import { mapProviderSuggestions, normalizeFormFields } from './suggestionMapping'
import { buildProvenance } from './suggestionProvenance'
import type { SuggestedFieldValue } from '../../../../../packages/shared/src/schemas'
import { SuggestionModeSchema } from '../../../../../packages/shared/src/schemas'
import {
  inferFieldSemantics,
  inferSemantics,
  normalizeSemanticText,
  resolveFieldSelectValue
} from './semanticMatching'

function normalizeMatchKey(value?: string): string {
  return normalizeSemanticText(value)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildSnippetKey(label: string, value?: string): string {
  const normalizedValue = value ? normalizeMatchKey(value) : ''
  return `${normalizeMatchKey(label)}::${normalizedValue}`
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function hasCandidateMatch(candidates: string[], snippetLabel: string): boolean {
  return candidates.some((candidate) => candidate === snippetLabel)
}

function splitFullName(value: string): { first: string; last: string } | null {
  const parts = value.split(/\s+/).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) {
    return null
  }

  return {
    first: parts[0],
    last: parts.slice(1).join(' ')
  }
}

function parseGermanAddress(value: string): { street?: string; zip?: string; city?: string } {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const zipMatch = normalized.match(/\b(\d{5})\b/)
  if (!zipMatch) {
    return { street: normalized || undefined }
  }

  const zip = zipMatch[1]
  const beforeZip = normalized
    .slice(0, Math.max(0, zipMatch.index ?? 0))
    .replace(/[\s,;-]+$/g, '')
    .trim()
  const afterZip = normalized
    .slice((zipMatch.index ?? 0) + zip.length)
    .replace(/^[\s,;-]+/g, '')
    .trim()

  const city = afterZip.split(',')[0]?.trim()

  return {
    street: beforeZip || undefined,
    zip,
    city: city || undefined
  }
}

function createDerivedSnippet(params: {
  base: RetrievedKnowledgeSnippet
  label: string
  value: string
  tags?: string[]
}): RetrievedKnowledgeSnippet {
  return {
    id: `derived_${params.base.id}_${slugify(params.label)}`,
    profileId: params.base.profileId,
    label: params.label,
    value: params.value,
    summary: undefined,
    tags: params.tags,
    sourceId: params.base.sourceId,
    sourceLabel: params.base.sourceLabel,
    sensitivity: params.base.sensitivity,
    score: params.base.score + 0.5
  }
}

function deriveKnowledgeSnippets(
  snippets: RetrievedKnowledgeSnippet[]
): RetrievedKnowledgeSnippet[] {
  const derived: RetrievedKnowledgeSnippet[] = []
  const existingKeys = new Set(snippets.map((snippet) => buildSnippetKey(snippet.label, snippet.value)))

  const addDerived = (snippet: RetrievedKnowledgeSnippet, label: string, value?: string, tags?: string[]) => {
    const trimmed = value?.trim()
    if (!trimmed) {
      return
    }
    const key = buildSnippetKey(label, trimmed)
    if (existingKeys.has(key)) {
      return
    }
    existingKeys.add(key)
    derived.push(createDerivedSnippet({ base: snippet, label, value: trimmed, tags }))
  }

  snippets.forEach((snippet) => {
    if (!snippet.value) {
      return
    }

    const normalizedLabel = normalizeMatchKey(snippet.label)

    const isName = hasKeyword(normalizedLabel, ['name', 'full name'])
    const isFirstName = hasKeyword(normalizedLabel, ['first name', 'vorname'])
    const isLastName = hasKeyword(normalizedLabel, ['last name', 'nachname'])

    if (isName && !isFirstName && !isLastName) {
      const split = splitFullName(snippet.value)
      if (split) {
        addDerived(snippet, 'Vorname', split.first, ['first name', 'given name'])
        addDerived(snippet, 'Nachname', split.last, ['last name', 'surname'])
      }
    }

    const isAddress = hasKeyword(normalizedLabel, ['address', 'home address', 'adresse', 'anschrift'])
    if (isAddress || /\b\d{5}\b/.test(snippet.value)) {
      const parsed = parseGermanAddress(snippet.value)
      addDerived(snippet, 'Straße', parsed.street, ['street', 'address line'])
      addDerived(snippet, 'PLZ', parsed.zip, ['zip', 'postal code', 'postleitzahl'])
      addDerived(snippet, 'Ort', parsed.city, ['city', 'stadt', 'town'])
    }

    if (hasKeyword(normalizedLabel, ['email', 'e mail', 'e-mail'])) {
      addDerived(snippet, 'E-Mail', snippet.value, ['email', 'email address'])
    }

    if (hasKeyword(normalizedLabel, ['phone', 'telefon', 'phone number', 'mobile'])) {
      addDerived(snippet, 'Telefon', snippet.value, ['phone', 'phone number'])
    }

    if (hasKeyword(normalizedLabel, ['salary', 'gehalt', 'gehaltsvorstellung'])) {
      addDerived(snippet, 'Gehaltsvorstellung', snippet.value, ['salary expectation', 'desired salary'])
    }

    if (hasKeyword(normalizedLabel, ['current job end', 'job end', 'end date', 'employment end', 'notice period'])) {
      addDerived(snippet, 'Frühster Eintrittstermin', snippet.value, ['earliest start', 'start date', 'availability'])
    }
  })

  return derived
}

function augmentKnowledgeSnippets(
  snippets: RetrievedKnowledgeSnippet[]
): RetrievedKnowledgeSnippet[] {
  const index = new Map(
    [...snippets, ...deriveKnowledgeSnippets(snippets)].map((snippet) => [snippet.id, snippet])
  )
  return Array.from(index.values())
}

type ExactMatchSnippet = {
  id: string
  profileId: string
  label: string
  value?: string
  tags?: string[]
  aliases?: string[]
  sourceId: string
  sourceLabel?: string
  sensitivity: string
  score: number
}

function buildExactMatchSuggestions(params: {
  fields: SuggestionField[]
  snippets: RetrievedKnowledgeSnippet[]
  activeProfileId: string
}): { matched: SuggestedFieldValue[]; remaining: SuggestionField[] } {
  const snippets = params.snippets as unknown as ExactMatchSnippet[]
  const snippetIndex = new Map(
    (params.snippets as RetrievedKnowledgeSnippet[]).map((snippet) => [snippet.id, snippet])
  )
  const matched: SuggestedFieldValue[] = []
  const remaining: ReturnType<typeof normalizeFormFields> = []

  params.fields.forEach((field) => {
    if (field.type?.toLowerCase() === 'file') {
      remaining.push(field)
      return
    }
    const candidates = [
      field.label,
      field.name,
      field.id,
      field.ariaLabel,
      field.placeholder,
      field.autocomplete,
      field.title,
      field.inputMode
    ]
      .map(normalizeMatchKey)
      .filter(Boolean)

    const fieldSemantics = inferFieldSemantics(field)
    let best: { snippet: ExactMatchSnippet; resolvedValue: string; rank: number } | null = null

    for (const snippet of snippets) {
      if (!snippet.value) {
        continue
      }
      const snippetLabel = normalizeMatchKey(snippet.label)
      const tagMatch = [...(snippet.tags ?? []), ...(snippet.aliases ?? [])]
        .some((tag) => hasCandidateMatch(candidates, normalizeMatchKey(tag)))
      const labelMatch = snippetLabel && hasCandidateMatch(candidates, snippetLabel)
      const snippetSemantics = inferSemantics([
        snippet.label,
        ...(snippet.tags ?? []),
        ...(snippet.aliases ?? [])
      ])
      const semanticMatch = [...fieldSemantics].some((semantic) => snippetSemantics.has(semantic))
      const resolvedValue = resolveFieldSelectValue(field, snippet.value)

      if (resolvedValue && (labelMatch || tagMatch || semanticMatch)) {
        const explicitGenderBonus = fieldSemantics.has('gender') && snippetSemantics.has('gender') ? 2 : 0
        const rank = snippet.score + (semanticMatch ? 3 : 0) + explicitGenderBonus + (field.kind === 'select' ? 2 : 0)
        if (!best || rank > best.rank) {
          best = { snippet, resolvedValue, rank }
        }
      }
    }

    if (best) {
      const matchedSnippet = best.snippet
      const fieldLabel =
        field.label ?? field.ariaLabel ?? field.placeholder ?? field.name ?? 'Unknown field'
      const fieldName = field.name ?? field.id
      const provenance = buildProvenance({
        activeProfileId: params.activeProfileId,
        knowledgeEntryIds: [matchedSnippet.id],
        sourceIds: [matchedSnippet.sourceId],
        snippetIndex
      })

      matched.push({
        fieldId: field.id,
        fieldLocator: field.locator,
        fieldName,
        fieldLabel,
        suggestedValue: best.resolvedValue,
        valueType: 'direct-copy',
        confidence: 'high',
        reasoningSummary: 'Exact match to profile knowledge.',
        provenance,
        sensitivity: matchedSnippet.sensitivity as SuggestedFieldValue['sensitivity'],
        requiresUserConfirmation: true,
        warnings: []
      })
    } else {
      remaining.push(field)
    }
  })

  return { matched, remaining }
}

function mergeExactAndProviderSuggestions(params: {
  exactSuggestions: SuggestedFieldValue[]
  providerSuggestions: SuggestedFieldValue[]
  preferProvider?: boolean
}): SuggestedFieldValue[] {
  const mergedByFieldId = new Map<string, SuggestedFieldValue>()

  params.providerSuggestions.forEach((suggestion) => {
    mergedByFieldId.set(suggestion.fieldId, suggestion)
  })

  params.exactSuggestions.forEach((suggestion) => {
    const providerSuggestion = mergedByFieldId.get(suggestion.fieldId)

    if (!providerSuggestion || providerSuggestion.suggestedValue === null) {
      const fallbackWarnings = providerSuggestion
        ? [...suggestion.warnings, ...providerSuggestion.warnings, 'Deterministic fallback used.']
        : suggestion.warnings
      mergedByFieldId.set(suggestion.fieldId, { ...suggestion, warnings: fallbackWarnings })
      return
    }

    if (params.preferProvider) {
      return
    }

    mergedByFieldId.set(suggestion.fieldId, {
      ...suggestion,
      warnings: [
        ...suggestion.warnings,
        ...providerSuggestion.warnings,
        'Deterministic match used instead of the provider suggestion.'
      ]
    })
  })

  return Array.from(mergedByFieldId.values())
}

function completeSuggestionSet(params: {
  fields: SuggestionField[]
  suggestions: SuggestedFieldValue[]
  activeProfileId: string
}): SuggestedFieldValue[] {
  const suggestionsByFieldId = new Map(
    params.suggestions.map((suggestion) => [suggestion.fieldId, suggestion])
  )

  return params.fields.map((field) => suggestionsByFieldId.get(field.id) ?? {
    fieldId: field.id,
    fieldLocator: field.locator,
    fieldName: field.name ?? field.id,
    fieldLabel: field.label ?? field.ariaLabel ?? field.placeholder ?? field.name ?? field.id,
    suggestedValue: null,
    valueType: 'unknown',
    confidence: 'low',
    reasoningSummary: 'Field detected, but no reliable profile match was found.',
    provenance: {
      profileId: params.activeProfileId,
      knowledgeEntryIds: [],
      sourceIds: []
    },
    sensitivity: 'normal',
    requiresUserConfirmation: true,
    warnings: ['No reliable suggestion available.']
  })
}

export interface SuggestionEngineDependencies {
  providerRegistry?: LlmProviderRegistry
  knowledgeRetriever?: KnowledgeRetriever
}

export function createSuggestionEngine(deps: SuggestionEngineDependencies = {}) {
  const knowledgeRetriever = deps.knowledgeRetriever ?? createDefaultKnowledgeRetriever()

  return {
    async generateSuggestionsForPage(
      input: GenerateSuggestionsForPageInput
    ): Promise<SuggestionGenerationResult> {
      if (!input.activeProfileId) {
        throw new LlmError('NO_ACTIVE_PROFILE', 'No active profile selected.')
      }
      if (!SuggestionModeSchema.safeParse(input.suggestionMode).success) {
        throw new LlmError('SCHEMA_VALIDATION_ERROR', 'Unknown suggestion mode.')
      }

      const fields = normalizeFormFields(input.fields)
      const profile = await knowledgeRetriever.getProfile(input.activeProfileId)
      if (!profile) {
        throw new LlmError('NO_ACTIVE_PROFILE', 'Active profile not found.')
      }

      const rawSnippets = await knowledgeRetriever.getRelevantSnippets({
        profileId: input.activeProfileId,
        fields,
        maxSnippets: Number.MAX_SAFE_INTEGER,
        includeUnmatched: true
      })

      if (rawSnippets.length === 0) {
        throw new LlmError('NO_KNOWLEDGE_SNIPPETS', 'No relevant knowledge snippets found.')
      }

      const guardResult = runPromptInjectionGuards(fields)
      const usesLlm = input.suggestionMode !== 'deterministic-only'
      const providerMode = getProviderMode(input.providerId)

      if (usesLlm && guardResult.severity === 'high' && providerMode === 'cloud') {
        throw new LlmError(
          'PROMPT_INJECTION_DETECTED',
          'Suspicious prompt injection patterns detected. Cloud mode blocked.'
        )
      }

      const policyResult = !usesLlm
        ? {
          allowedSnippets: rawSnippets,
          blockedSnippets: [],
          warnings: [
            {
              code: 'DETERMINISTIC_ONLY',
              message: 'Deterministic-only mode: no LLM provider was called.'
            }
          ]
        }
        : applySensitiveDataPolicy(rawSnippets, {
          providerMode,
          privacyMode: input.privacyMode,
          promptInjectionDetected: guardResult.hasSuspiciousFields
        })

      const localSnippets = augmentKnowledgeSnippets(rawSnippets)
      const providerSnippets = minimizeKnowledgeSnippets(
        policyResult.allowedSnippets,
        policyResult.allowedSnippets.length,
        {
          allowZeroScore: true,
          skipTruncate: true
        }
      )
      const augmentedProviderSnippets = augmentKnowledgeSnippets(providerSnippets)

      const minimizedFields = minimizeFields(fields, fields.length, { skipTruncate: true })

      if (usesLlm && input.providerId === 'openai' && input.privacyMode !== 'cloud-opt-in') {
        throw new LlmError(
          'CLOUD_MODE_DISABLED',
          'Cloud mode is disabled. Enable opt-in to use OpenAI.'
        )
      }

      const { matched: exactSuggestions, remaining } = buildExactMatchSuggestions({
        fields: minimizedFields,
        snippets: localSnippets,
        activeProfileId: profile.id
      })

      let providerResponse: LlmProviderResponse | null = null
      let providerSuggestions: SuggestedFieldValue[] = []
      let providerResultMode: SuggestionGenerationResult['provider']['mode'] = 'none'
      const llmEligibleFields = minimizedFields.filter(
        (field) => field.type?.toLowerCase() !== 'file'
      )
      const providerFields = input.suggestionMode === 'full-context'
        ? llmEligibleFields
        : input.suggestionMode === 'identifier-only'
          ? remaining.filter((field) => field.type?.toLowerCase() !== 'file')
          : []
      const requestFields = augmentedProviderSnippets.length > 0 ? providerFields : []

      if (requestFields.length > 0) {
        const registry = deps.providerRegistry
        if (!registry) throw new LlmError('PROVIDER_UNAVAILABLE', 'Provider runtime is unavailable.')
        const provider = registry.getProvider(input.providerId)
        providerResultMode = provider.mode
        providerResponse = await provider.generateFieldSuggestions({
          pageContext: input.pageContext,
          activeProfile: profile,
          fields: requestFields,
          knowledgeSnippets: augmentedProviderSnippets,
          privacyMode: input.privacyMode,
          providerId: input.providerId,
          suggestionMode: input.suggestionMode as 'full-context' | 'identifier-only',
          injectionWarnings: guardResult.warnings
        })

        providerSuggestions = mapProviderSuggestions({
          providerSuggestions: providerResponse.response.suggestions,
          fields: requestFields,
          knowledgeSnippets: augmentedProviderSnippets,
          activeProfileId: profile.id,
          suggestionMode: input.suggestionMode as 'full-context' | 'identifier-only',
          fieldWarnings: guardResult.fieldWarnings
        })
      }

      const partialSuggestions = input.suggestionMode === 'deterministic-only'
        ? exactSuggestions
        : mergeExactAndProviderSuggestions({
          exactSuggestions,
          providerSuggestions,
          preferProvider: input.suggestionMode === 'full-context'
        })
      const suggestions = completeSuggestionSet({
        fields: minimizedFields,
        suggestions: partialSuggestions,
        activeProfileId: profile.id
      })

      const warnings = [
        ...guardResult.warnings,
        ...policyResult.warnings,
        ...(providerResponse?.response.warnings ?? []).map((message: string) => ({
          code: 'PROVIDER_WARNING',
          message
        }))
      ]

      return {
        suggestions,
        provider: {
          id: input.providerId,
          mode: providerResultMode,
          model: providerResponse?.model
        },
        warnings,
        debug: {
          minimizedFields: requestFields,
          minimizedSnippets: usesLlm ? augmentedProviderSnippets : localSnippets
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          activeProfileId: profile.id,
          fieldsReceived: fields.length,
          suggestionsReturned: suggestions.length,
          knowledgeSnippetsUsed: usesLlm ? augmentedProviderSnippets.length : localSnippets.length
        }
      }
    }
  }
}

export async function generateSuggestionsForPage(
  input: GenerateSuggestionsForPageInput,
  deps?: SuggestionEngineDependencies
): Promise<SuggestionGenerationResult> {
  return createSuggestionEngine(deps).generateSuggestionsForPage(input)
}
