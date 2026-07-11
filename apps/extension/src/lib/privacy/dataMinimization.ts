import type { RetrievedKnowledgeSnippet, SuggestionField } from '../../features/suggestions/suggestionTypes'

const MAX_TEXT_LENGTH = 180
const MAX_OPTIONS = 12

function truncateText(value?: string): string | undefined {
  if (!value) {
    return undefined
  }
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}...` : value
}

export function minimizeFields(
  fields: SuggestionField[],
  maxFields: number,
  options?: { skipTruncate?: boolean }
): SuggestionField[] {
  const truncate = options?.skipTruncate ? (value?: string) => value : truncateText

  return fields.slice(0, maxFields).map((field) => ({
    id: field.id,
    name: truncate(field.name),
    label: truncate(field.label),
    placeholder: truncate(field.placeholder),
    ariaLabel: truncate(field.ariaLabel),
    type: truncate(field.type),
    value: truncate(field.value),
    options: field.options
      ? field.options
          .slice(0, MAX_OPTIONS)
          .map((option) => truncate(option) ?? '')
          .filter(Boolean)
      : undefined,
    kind: field.kind
  }))
}

export function minimizeKnowledgeSnippets(
  snippets: RetrievedKnowledgeSnippet[],
  maxSnippets: number,
  options?: { allowZeroScore?: boolean; skipTruncate?: boolean }
): RetrievedKnowledgeSnippet[] {
  const filtered = options?.allowZeroScore
    ? snippets
    : snippets.filter((snippet) => snippet.score > 0)
  const sorted = [...filtered].sort((a, b) => b.score - a.score)

  const truncate = options?.skipTruncate ? (value?: string) => value : truncateText

  return sorted.slice(0, maxSnippets).map((snippet) => ({
    id: snippet.id,
    profileId: snippet.profileId,
    label: truncate(snippet.label) ?? snippet.label,
    value: truncate(snippet.value),
    summary: truncate(snippet.summary),
    tags: snippet.tags,
    sourceId: snippet.sourceId,
    sourceLabel: truncate(snippet.sourceLabel),
    sensitivity: snippet.sensitivity,
    score: snippet.score
  }))
}
