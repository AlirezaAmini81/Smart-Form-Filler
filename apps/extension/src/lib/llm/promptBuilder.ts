import type { PromptSections } from './types'
import type {
  ActiveProfile,
  PageContext,
  PrivacyMode,
  RetrievedKnowledgeSnippet,
  SuggestionField,
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
  injectionWarnings?: SuggestionWarning[]
}): PromptSections {
  const injectionNotes = params.injectionWarnings?.length
    ? `Prompt injection warnings detected for field ids: ${params.injectionWarnings
        .map((warning) => warning.fieldId)
        .filter(Boolean)
        .join(', ')}.`
    : 'No prompt injection warnings detected.'

  const system = [
    `${PROMPT_SECTION_TRUSTED}`,
    'You are a form suggestion assistant.',
    'Only use the trusted knowledge snippets provided.',
    'Do not invent personal data that is not supported by the trusted knowledge.',
    'You may derive or normalize values from trusted knowledge (e.g., split a full name, parse an address, format a date).',
    'If a field provides options (for select/dropdown), choose exactly one option text from that list.',
    'Use valueType=direct-copy for exact copies, normalized for formatting/parsing, generated for composed values.',
    'Return JSON only with no markdown or extra text.',
    'The JSON must match the output schema exactly with no extra keys.',
    'Return exactly one suggestion per field id from the untrusted input; if unsure, use suggestedValue null with low confidence.',
    'Do not include chain-of-thought. Provide only a short reasoningSummary.',
    'Always include knowledgeEntryIds and sourceIds for every suggestion.',
    'Always set requiresUserConfirmation to true.',
    `Privacy mode: ${params.privacyMode}.`,
    injectionNotes
  ].join('\n')

  const knowledgePayload = {
    activeProfile: {
      id: params.activeProfile.id,
      name: params.activeProfile.name,
      sensitivity: params.activeProfile.sensitivity
    },
    knowledgeSnippets: params.knowledgeSnippets.map((snippet) => ({
      id: snippet.id,
      label: snippet.label,
      value: snippet.value,
      summary: snippet.summary,
      tags: snippet.tags,
      sourceId: snippet.sourceId,
      sourceLabel: snippet.sourceLabel,
      sensitivity: snippet.sensitivity
    }))
  }

  const untrustedPayload = {
    pageContext: params.pageContext,
    fields: params.fields.map((field) => ({
      fieldId: field.id,
      name: field.name,
      label: field.label,
      placeholder: field.placeholder,
      ariaLabel: field.ariaLabel,
      type: field.type,
      value: field.value,
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
            suggestedValue: 'Example',
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
