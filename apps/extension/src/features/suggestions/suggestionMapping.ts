import type { SuggestedFieldValue } from '../../../../../packages/shared/src/schemas'
import type {
  FormFieldInput,
  ProviderSuggestion,
  RetrievedKnowledgeSnippet,
  SuggestionField
} from './suggestionTypes'
import { buildProvenance } from './suggestionProvenance'

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
      name: field.name,
      label: field.label,
      placeholder: field.placeholder,
      ariaLabel: field.ariaLabel,
      type: field.type,
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
  fieldWarnings?: Record<string, string[]>
}): SuggestedFieldValue[] {
  const fieldIndex = new Map(params.fields.map((field) => [field.id, field]))
  const snippetIndex = new Map(params.knowledgeSnippets.map((snippet) => [snippet.id, snippet]))

  return params.providerSuggestions.map((suggestion) => {
    const field = fieldIndex.get(suggestion.fieldId)
    const fieldLabel =
      field?.label ?? field?.ariaLabel ?? field?.placeholder ?? field?.name ?? 'Unknown field'
    const fieldName = field?.name ?? field?.id

    const resolvedSensitivity = resolveSensitivity(
      suggestion.sensitivity as Sensitivity,
      suggestion.knowledgeEntryIds,
      snippetIndex
    )

    const warnings = [...suggestion.warnings]
    const fieldWarningList = params.fieldWarnings?.[suggestion.fieldId]
    if (fieldWarningList?.length) {
      warnings.push(...fieldWarningList)
    }

    if (!field) {
      warnings.push('Field id was not found in the request payload.')
    }

    let requiresUserConfirmation = suggestion.requiresUserConfirmation
    if (!requiresUserConfirmation) {
      requiresUserConfirmation = true
      warnings.push('User confirmation enforced for safety.')
    }

    return {
      fieldId: suggestion.fieldId,
      fieldName,
      fieldLabel,
      suggestedValue: suggestion.suggestedValue,
      valueType: suggestion.valueType,
      confidence: suggestion.confidence,
      reasoningSummary: suggestion.reasoningSummary,
      provenance: buildProvenance({
        activeProfileId: params.activeProfileId,
        knowledgeEntryIds: suggestion.knowledgeEntryIds,
        sourceIds: suggestion.sourceIds,
        snippetIndex
      }),
      sensitivity: resolvedSensitivity,
      requiresUserConfirmation,
      warnings
    }
  })
}
