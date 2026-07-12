import type { PromptSections } from './types'
import type {
  ActiveProfile,
  PageContext,
  PrivacyMode,
  RetrievedKnowledgeSnippet,
  SuggestionField,
  SuggestionMode,
  SuggestionWarning
} from '../../features/suggestions/suggestionTypes'

export const PROMPT_SECTION_TRUSTED = 'TRUSTED INSTRUCTIONS'
export const PROMPT_SECTION_KNOWLEDGE = 'TRUSTED KNOWLEDGE SNIPPETS'
export const PROMPT_SECTION_UNTRUSTED = 'UNTRUSTED WEBPAGE FORM DATA'
export const PROMPT_SECTION_OUTPUT = 'OUTPUT FORMAT'
export const PROMPT_SCHEMA_VERSION = 'v1'

export function buildSuggestionPrompt(params: {
  pageContext: PageContext
  activeProfile: ActiveProfile
  fields: SuggestionField[]
  knowledgeSnippets: RetrievedKnowledgeSnippet[]
  privacyMode: PrivacyMode
  suggestionMode: Exclude<SuggestionMode, 'deterministic-only'>
  injectionWarnings?: SuggestionWarning[]
}): PromptSections {
  const injectionNotes = params.injectionWarnings?.length
    ? `Prompt injection warnings detected for field ids: ${params.injectionWarnings
        .map((warning) => warning.fieldId)
        .filter(Boolean)
        .join(', ')}.`
    : 'No prompt injection warnings detected.'

  const identifierOnly = params.suggestionMode === 'identifier-only'
  const modeInstructions = identifierOnly
    ? [
        'Map each unresolved form field to at most one trusted knowledge snippet id.',
        'Knowledge values are intentionally withheld and will be resolved locally.',
        'Set suggestedValue to null. Do not infer, compose, or generate personal values.',
        'Use knowledgeEntryIds to return the selected snippet id, or an empty array when unsure.'
      ]
    : [
        'Use one or more trusted snippets when a field requires combined information.',
        'You may derive, combine, or normalize values, including date formatting requested by field context.',
        'Every non-null value must cite all supporting knowledgeEntryIds.'
      ]

  const system = [
    `${PROMPT_SECTION_TRUSTED}`,
    'You are a form suggestion assistant.',
    'Only use the trusted knowledge snippets provided.',
    'Do not invent personal data that is not supported by the trusted knowledge.',
    ...modeInstructions,
    'If a field provides options (for select/dropdown), choose exactly one option text from that list.',
    'Treat common salutations as evidence for compatible gender-valued options when no explicit gender fact is available (for example Mr/Herr -> male/männlich and Ms/Mrs/Frau -> female/weiblich).',
    'Use valueType=direct-copy for exact copies, normalized for formatting/parsing, generated for composed values.',
    'Return JSON only with no markdown or extra text.',
    'The JSON must match the output schema exactly with no extra keys.',
    'Return exactly one suggestion per field id from the untrusted input; if unsure, use suggestedValue null with low confidence.',
    'Do not include chain-of-thought. Provide only a short reasoningSummary.',
    'Always include knowledgeEntryIds and sourceIds for every suggestion.',
    'Always set requiresUserConfirmation to true.',
    `Privacy mode: ${params.privacyMode}.`,
    `Suggestion mode: ${params.suggestionMode}.`,
    injectionNotes
  ].join('\n')

  const knowledgePayload = {
    activeProfile: {
      id: params.activeProfile.id,
      name: identifierOnly ? undefined : params.activeProfile.name,
      sensitivity: params.activeProfile.sensitivity
    },
    knowledgeSnippets: params.knowledgeSnippets.map((snippet) => ({
      id: snippet.id,
      label: snippet.label,
      value: identifierOnly ? undefined : snippet.value,
      summary: identifierOnly ? undefined : snippet.summary,
      tags: snippet.tags,
      aliases: snippet.aliases,
      sourceId: snippet.sourceId,
      sourceLabel: identifierOnly ? undefined : snippet.sourceLabel,
      sensitivity: snippet.sensitivity
    }))
  }

  const untrustedPayload = {
    pageContext: identifierOnly
      ? {
          hostname: params.pageContext.hostname,
          language: params.pageContext.language
        }
      : params.pageContext,
    fields: params.fields.map((field) => ({
      fieldId: field.id,
      name: field.name,
      label: field.label,
      placeholder: field.placeholder,
      ariaLabel: field.ariaLabel,
      autocomplete: field.autocomplete,
      title: field.title,
      inputMode: field.inputMode,
      type: field.type,
      value: identifierOnly ? undefined : field.value,
      kind: field.kind,
      options: field.options
    }))
  }

  const trustedKnowledge = [
    `${PROMPT_SECTION_KNOWLEDGE}`,
    JSON.stringify(knowledgePayload, null, 2)
  ].join('\n')

  const untrustedForm = [
    `${PROMPT_SECTION_UNTRUSTED}`,
    JSON.stringify(untrustedPayload, null, 2)
  ].join('\n')

  const outputSchema = [
    `${PROMPT_SECTION_OUTPUT}`,
    'Return JSON only with this shape:',
    JSON.stringify(
      {
        suggestions: [
          {
            fieldId: 'field_1',
            suggestedValue: identifierOnly ? null : 'Example',
            valueType: 'direct-copy',
            confidence: 'high',
            reasoningSummary: 'Short user-facing rationale.',
            knowledgeEntryIds: ['entry_id'],
            sourceIds: ['source_id'],
            sensitivity: 'normal',
            requiresUserConfirmation: true,
            warnings: []
          }
        ],
        warnings: []
      },
      null,
      2
    )
  ].join('\n')

  const user = [trustedKnowledge, untrustedForm, outputSchema].join('\n\n')
  const fullPrompt = [system, user].join('\n\n')

  return {
    system,
    trustedKnowledge,
    untrustedForm,
    outputSchema,
    user,
    fullPrompt,
    schemaVersion: PROMPT_SCHEMA_VERSION
  }
}
