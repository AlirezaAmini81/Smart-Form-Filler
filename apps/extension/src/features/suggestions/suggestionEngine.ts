import { getDefaultLlmConfig, mergeLlmConfig } from '../../lib/config/llmConfig'
import { createProviderRegistry, getProviderMode } from '../../lib/llm/providerRegistry'
import { LlmError } from '../../lib/llm/errors'
import { minimizeFields, minimizeKnowledgeSnippets } from '../../lib/privacy/dataMinimization'
import { runPromptInjectionGuards } from '../../lib/privacy/promptInjectionGuards'
import { applySensitiveDataPolicy } from '../../lib/privacy/sensitiveDataPolicy'
import type { LlmProviderRegistry } from '../../lib/llm/providerRegistry'
import type { LlmConfig } from '../../lib/config/llmConfig'
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

function normalizeMatchKey(value?: string): string {
  if (!value) {
    return ''
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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

type ExactMatchSnippet = {
  id: string
  profileId: string
  label: string
  value?: string
  tags?: string[]
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

  const resolveSelectOption = (field: SuggestionField, value: string): string => {
    if (field.kind !== 'select' || !field.options?.length) {
      return value
    }

    const normalized = value.toLowerCase()
    const exact = field.options.find((option) => option.toLowerCase() === normalized)
    if (exact) {
      return exact
    }

    const partial = field.options.find((option) => option.toLowerCase().includes(normalized))
    return partial ?? value
  }

  params.fields.forEach((field) => {
    const candidates = [
      field.label,
      field.name,
      field.id,
      field.ariaLabel,
      field.placeholder
    ]
      .map(normalizeMatchKey)
      .filter(Boolean)

    let best: any = null

    snippets.forEach((snippet) => {
      const snippetLabel = normalizeMatchKey(snippet.label)
      const tagMatch = snippet.tags?.some((tag) => hasCandidateMatch(candidates, normalizeMatchKey(tag)))
      const labelMatch = snippetLabel && hasCandidateMatch(candidates, snippetLabel)

      if (labelMatch || tagMatch) {
        if (!best || snippet.score > best.score) {
          best = snippet
        }
      }
    })

    if (best?.value) {
      const fieldLabel =
        field.label ?? field.ariaLabel ?? field.placeholder ?? field.name ?? 'Unknown field'
      const fieldName = field.name ?? field.id
      const provenance = buildProvenance({
        activeProfileId: params.activeProfileId,
        knowledgeEntryIds: [best.id],
        sourceIds: [best.sourceId],
        snippetIndex
      })
      const resolvedValue = resolveSelectOption(field, best.value)

      matched.push({
        fieldId: field.id,
        fieldName,
        fieldLabel,
        suggestedValue: resolvedValue,
        valueType: 'direct-copy',
        confidence: 'high',
        reasoningSummary: 'Exact match to profile knowledge.',
        provenance,
        sensitivity: best.sensitivity as SuggestedFieldValue['sensitivity'],
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
}): SuggestedFieldValue[] {
  const mergedByFieldId = new Map<string, SuggestedFieldValue>()

  params.providerSuggestions.forEach((suggestion) => {
    mergedByFieldId.set(suggestion.fieldId, suggestion)
  })

  params.exactSuggestions.forEach((suggestion) => {
    const providerSuggestion = mergedByFieldId.get(suggestion.fieldId)

    if (!providerSuggestion) {
      mergedByFieldId.set(suggestion.fieldId, suggestion)
      return
    }

    mergedByFieldId.set(suggestion.fieldId, {
      ...suggestion,
      warnings: [
        ...suggestion.warnings,
        ...providerSuggestion.warnings,
        'Deterministic exact match used; LLM backend also received this field.'
      ]
    })
  })

  return Array.from(mergedByFieldId.values())
}

export interface SuggestionEngineDependencies {
  providerRegistry?: LlmProviderRegistry
  knowledgeRetriever?: KnowledgeRetriever
  config?: LlmConfig
}

export function createSuggestionEngine(deps: SuggestionEngineDependencies = {}) {
  const baseConfig = deps.config ?? getDefaultLlmConfig()
  const knowledgeRetriever = deps.knowledgeRetriever ?? createDefaultKnowledgeRetriever()

  return {
    async generateSuggestionsForPage(
      input: GenerateSuggestionsForPageInput
    ): Promise<SuggestionGenerationResult> {
      if (!input.activeProfileId) {
        throw new LlmError('NO_ACTIVE_PROFILE', 'No active profile selected.')
      }

      const fields = normalizeFormFields(input.fields)
      const profile = await knowledgeRetriever.getProfile(input.activeProfileId)
      if (!profile) {
        throw new LlmError('NO_ACTIVE_PROFILE', 'Active profile not found.')
      }

      const rawSnippets = await knowledgeRetriever.getRelevantSnippets({
        profileId: input.activeProfileId,
        fields,
        maxSnippets: baseConfig.requestLimits.maxKnowledgeSnippets
      })

      if (rawSnippets.length === 0) {
        throw new LlmError('NO_KNOWLEDGE_SNIPPETS', 'No relevant knowledge snippets found.')
      }

      const guardResult = runPromptInjectionGuards(fields)
      const providerMode = getProviderMode(input.providerId)
      const privacyLevel = Number.isFinite(input.privacyLevel)
        ? Math.min(2, Math.max(0, Math.round(input.privacyLevel ?? 1)))
        : 1
      const isLowPrivacy = privacyLevel === 0
      const isHighPrivacy = privacyLevel === 2

      if (!isLowPrivacy && guardResult.severity === 'high' && providerMode === 'cloud') {
        throw new LlmError(
          'PROMPT_INJECTION_DETECTED',
          'Suspicious prompt injection patterns detected. Cloud mode blocked.'
        )
      }

      const policyResult = isLowPrivacy
        ? {
          allowedSnippets: rawSnippets,
          blockedSnippets: [],
          warnings: [
            {
              code: 'PRIVACY_LOW',
              message: providerMode === 'cloud'
                ? 'Low privacy level: all snippets are included for cloud processing.'
                : 'Low privacy level: all snippets are included for local processing.'
            }
          ]
        }
        : applySensitiveDataPolicy(rawSnippets, {
          providerMode,
          privacyMode: input.privacyMode,
          promptInjectionDetected: guardResult.hasSuspiciousFields
        })

      const maxSnippets = isLowPrivacy
        ? rawSnippets.length
        : isHighPrivacy
          ? Math.min(baseConfig.requestLimits.maxKnowledgeSnippets, 3)
          : baseConfig.requestLimits.maxKnowledgeSnippets

      const minimizedSnippets = minimizeKnowledgeSnippets(
        policyResult.allowedSnippets,
        maxSnippets,
        {
          allowZeroScore: !isHighPrivacy,
          skipTruncate: isLowPrivacy
        }
      )
      if (minimizedSnippets.length === 0) {
        throw new LlmError('NO_KNOWLEDGE_SNIPPETS', 'All knowledge snippets were filtered out.')
      }

      const derivedSnippets = deriveKnowledgeSnippets(minimizedSnippets)
      const augmentedSnippetIndex = new Map(
        [...minimizedSnippets, ...derivedSnippets].map((snippet) => [snippet.id, snippet])
      )
      const augmentedSnippets = Array.from(augmentedSnippetIndex.values())

      const maxFields = isLowPrivacy
        ? fields.length
        : isHighPrivacy
          ? Math.min(baseConfig.requestLimits.maxFieldsPerRequest, 10)
          : baseConfig.requestLimits.maxFieldsPerRequest

      const minimizedFields = minimizeFields(fields, maxFields, { skipTruncate: isLowPrivacy })

      if (input.providerId === 'openai' && input.privacyMode !== 'cloud-opt-in') {
        throw new LlmError(
          'CLOUD_MODE_DISABLED',
          'Cloud mode is disabled. Enable opt-in to use OpenAI.'
        )
      }

      const resolvedConfig = mergeLlmConfig(baseConfig, {
        openai: {
          cloudEnabled: input.privacyMode === 'cloud-opt-in'
        },
        ...(input.ollamaModel
          ? {
            ollama: {
              model: input.ollamaModel
            }
          }
          : {})
      })

      const { matched: exactSuggestions } = buildExactMatchSuggestions({
        fields: minimizedFields,
        snippets: augmentedSnippets,
        activeProfileId: profile.id
      })

      const registry = deps.providerRegistry ?? createProviderRegistry(resolvedConfig)
      const provider = registry.getProvider(input.providerId)

      let providerResponse: Awaited<ReturnType<typeof provider.generateFieldSuggestions>> | null = null
      let providerSuggestions: SuggestedFieldValue[] = []

      if (minimizedFields.length > 0) {
        providerResponse = await provider.generateFieldSuggestions({
          pageContext: input.pageContext,
          activeProfile: profile,
          fields: minimizedFields,
          knowledgeSnippets: augmentedSnippets,
          privacyMode: input.privacyMode,
          providerId: input.providerId,
          injectionWarnings: guardResult.warnings
        })

        providerSuggestions = mapProviderSuggestions({
          providerSuggestions: providerResponse.response.suggestions,
          fields: minimizedFields,
          knowledgeSnippets: augmentedSnippets,
          activeProfileId: profile.id,
          fieldWarnings: guardResult.fieldWarnings
        })
      }

      const suggestions = mergeExactAndProviderSuggestions({
        exactSuggestions,
        providerSuggestions
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
          id: provider.id,
          mode: provider.mode,
          model: providerResponse?.model
        },
        warnings,
        debug: {
          rawOutput: providerResponse?.rawText,
          parsedResponse: providerResponse?.response,
          minimizedFields,
          minimizedSnippets: augmentedSnippets
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          activeProfileId: profile.id,
          fieldsReceived: fields.length,
          suggestionsReturned: suggestions.length,
          knowledgeSnippetsUsed: augmentedSnippets.length
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