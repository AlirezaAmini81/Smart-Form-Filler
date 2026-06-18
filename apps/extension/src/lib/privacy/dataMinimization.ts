import type { RetrievedKnowledgeSnippet, SuggestionField } from '../../features/suggestions/suggestionTypes'

const MAX_TEXT_LENGTH = 180

function truncateText(value?: string): string | undefined {
  if (!value) {
    return undefined
  }
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}...` : value
}

export function minimizeFields(fields: SuggestionField[], maxFields: number): SuggestionField[] {
  return fields.slice(0, maxFields).map((field) => ({
    id: field.id,
    name: truncateText(field.name),
    label: truncateText(field.label),
    placeholder: truncateText(field.placeholder),
    ariaLabel: truncateText(field.ariaLabel),
    type: truncateText(field.type),
    kind: field.kind
  }))
}

export function minimizeKnowledgeSnippets(
  snippets: RetrievedKnowledgeSnippet[],
  maxSnippets: number
): RetrievedKnowledgeSnippet[] {
  const filtered = snippets.filter((snippet) => snippet.score > 0)
  const sorted = [...filtered].sort((a, b) => b.score - a.score)

  return sorted.slice(0, maxSnippets).map((snippet) => ({
    id: snippet.id,
    profileId: snippet.profileId,
    label: truncateText(snippet.label) ?? snippet.label,
    value: truncateText(snippet.value),
    summary: truncateText(snippet.summary),
    tags: snippet.tags,
    sourceId: snippet.sourceId,
    sourceLabel: truncateText(snippet.sourceLabel),
    sensitivity: snippet.sensitivity,
    score: snippet.score
  }))
}
