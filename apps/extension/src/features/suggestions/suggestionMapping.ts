import type { SuggestedFieldValue } from '../../../../../packages/shared/src/schemas'
import type {
  FormFieldInput,
  ProviderSuggestion,
  RetrievedKnowledgeSnippet,
  SuggestionField,
  SuggestionMode
} from './suggestionTypes'
import { buildProvenance } from './suggestionProvenance'
import { resolveFieldSelectValue } from './semanticMatching'

const SENSITIVITY_ORDER = ['public', 'normal', 'sensitive', 'secret'] as const

type Sensitivity = (typeof SENSITIVITY_ORDER)[number]

function normalizeFieldId(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized.length > 0 ? normalized : 'field'
}

function ensureUniqueFieldId(candidate: string, used: Set<string>): string {
  let unique = candidate
  let suffix = 1
  while (used.has(unique)) {
    unique = `${candidate}_${suffix}`
    suffix += 1
  }
  used.add(unique)
  return unique
}

export function normalizeFormFields(fields: FormFieldInput[]): SuggestionField[] {
  const used = new Set<string>()

  return fields.map((field, index) => {
    const base =
      field.id ??
      field.name ??
      field.label ??
      field.ariaLabel ??
      field.placeholder ??
      `field_${index + 1}`

    const normalized = normalizeFieldId(base)
    const fieldId = ensureUniqueFieldId(normalized, used)

    return {
      id: fieldId,
      locator: field.locator,
      name: field.name,
      label: field.label,
      placeholder: field.placeholder,
      ariaLabel: field.ariaLabel,
      autocomplete: field.autocomplete,
      title: field.title,
      inputMode: field.inputMode,
      type: field.type,
      value: field.value,
      options: field.options,
      kind: field.kind
    }
  })
}

export function createMockFormFields(): FormFieldInput[] {
  return [
    {
      id: 'full_name',
      name: 'full_name',
      label: 'Full name',
      placeholder: 'Jane Doe',
      type: 'text',
      kind: 'input'
    },
    {
      id: 'email',
      name: 'email',
      label: 'Email address',
      placeholder: 'jane@example.com',
      type: 'email',
      kind: 'input'
    },
    {
      id: 'phone',
      name: 'phone',
      label: 'Phone number',
      placeholder: '+49 555 123456',
      type: 'tel',
      kind: 'input'
    },
    {
      id: 'company',
      name: 'company',
      label: 'Company',
      placeholder: 'Acme GmbH',
      type: 'text',
      kind: 'input'
    }
  ]
}

function resolveSensitivity(
  providerSensitivity: Sensitivity,
  knowledgeEntryIds: string[],
  snippetsById: Map<string, RetrievedKnowledgeSnippet>
): Sensitivity {
  let highest = SENSITIVITY_ORDER.indexOf(providerSensitivity)

  knowledgeEntryIds.forEach((entryId) => {
    const snippet = snippetsById.get(entryId)
    if (!snippet) {
      return
    }
    const index = SENSITIVITY_ORDER.indexOf(snippet.sensitivity as Sensitivity)
    if (index > highest) {
      highest = index
    }
  })

  return SENSITIVITY_ORDER[highest]
}

export function mapProviderSuggestions(params: {
  providerSuggestions: ProviderSuggestion[]
  fields: SuggestionField[]
  knowledgeSnippets: RetrievedKnowledgeSnippet[]
  activeProfileId: string
  suggestionMode?: Exclude<SuggestionMode, 'deterministic-only'>
  fieldWarnings?: Record<string, string[]>
}): SuggestedFieldValue[] {
  const fieldIndex = new Map(params.fields.map((field) => [field.id, field]))
  const snippetIndex = new Map(params.knowledgeSnippets.map((snippet) => [snippet.id, snippet]))

  return params.providerSuggestions.flatMap((suggestion): SuggestedFieldValue[] => {
    const field = fieldIndex.get(suggestion.fieldId)
    if (!field) {
      return []
    }
    const fieldLabel =
      field?.label ?? field?.ariaLabel ?? field?.placeholder ?? field?.name ?? 'Unknown field'
    const fieldName = field?.name ?? field?.id

    const knownKnowledgeEntryIds = suggestion.knowledgeEntryIds.filter((id) => snippetIndex.has(id))
    const unknownKnowledgeEntryIds = suggestion.knowledgeEntryIds.filter((id) => !snippetIndex.has(id))
    const resolvedSensitivity = resolveSensitivity(
      suggestion.sensitivity as Sensitivity,
      knownKnowledgeEntryIds,
      snippetIndex
    )

    const warnings = [...suggestion.warnings]
    const fieldWarningList = params.fieldWarnings?.[suggestion.fieldId]
    if (fieldWarningList?.length) {
      warnings.push(...fieldWarningList)
    }

    if (unknownKnowledgeEntryIds.length > 0) {
      warnings.push('Suggestion referenced unknown knowledge entry ids.')
    }

    let requiresUserConfirmation = suggestion.requiresUserConfirmation
    if (!requiresUserConfirmation) {
      requiresUserConfirmation = true
      warnings.push('User confirmation enforced for safety.')
    }

    let candidateValue = suggestion.suggestedValue
    let valueType = suggestion.valueType
    if (params.suggestionMode === 'identifier-only') {
      candidateValue = null
      valueType = 'direct-copy'
      if (knownKnowledgeEntryIds.length === 1) {
        candidateValue = snippetIndex.get(knownKnowledgeEntryIds[0])?.value ?? null
      } else if (knownKnowledgeEntryIds.length > 1) {
        warnings.push('Identifier-only mode cannot compose values from multiple entries.')
      }
      if (!candidateValue && knownKnowledgeEntryIds.length > 0) {
        warnings.push('Mapped knowledge entry has no locally available value.')
      }
    } else if (candidateValue && knownKnowledgeEntryIds.length === 0) {
      candidateValue = null
      warnings.push('Suggestion value was rejected because it had no known knowledge provenance.')
    }
    if (field.type?.toLowerCase() === 'file') {
      candidateValue = null
      warnings.push('File inputs require manual user selection and cannot be suggested.')
    }

    const normalizedValue = candidateValue && field
      ? resolveFieldSelectValue(field, candidateValue)
      : candidateValue
    if (candidateValue && field?.kind === 'select' && !normalizedValue) {
      warnings.push('Suggested value does not match a supported select option.')
    }
    const knownSourceIds = Array.from(new Set(
      knownKnowledgeEntryIds
        .map((id) => snippetIndex.get(id)?.sourceId)
        .filter((id): id is string => Boolean(id))
    ))

    return [{
      fieldId: suggestion.fieldId,
      fieldLocator: field?.locator,
      fieldName,
      fieldLabel,
      suggestedValue: normalizedValue,
      valueType,
      confidence: suggestion.confidence,
      reasoningSummary: suggestion.reasoningSummary,
      provenance: buildProvenance({
        activeProfileId: params.activeProfileId,
        knowledgeEntryIds: knownKnowledgeEntryIds,
        sourceIds: knownSourceIds,
        snippetIndex
      }),
      sensitivity: resolvedSensitivity,
      requiresUserConfirmation,
      warnings
    }]
  })
}
