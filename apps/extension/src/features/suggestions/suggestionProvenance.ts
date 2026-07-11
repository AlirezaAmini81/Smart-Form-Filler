import type { SuggestionProvenance } from '../../../../../packages/shared/src/schemas'
import type { RetrievedKnowledgeSnippet } from './suggestionTypes'

export function buildProvenance(params: {
  activeProfileId: string
  knowledgeEntryIds: string[]
  sourceIds: string[]
  snippetIndex: Map<string, RetrievedKnowledgeSnippet>
}): SuggestionProvenance {
  const sourceLabels = new Set<string>()

  params.sourceIds.forEach((sourceId) => {
    const snippet = [...params.snippetIndex.values()].find(
      (entry) => entry.sourceId === sourceId
    )
    if (snippet?.sourceLabel) {
      sourceLabels.add(snippet.sourceLabel)
    }
  })

  const provenance: SuggestionProvenance = {
    profileId: params.activeProfileId,
    knowledgeEntryIds: params.knowledgeEntryIds,
    sourceIds: params.sourceIds
  }

  if (sourceLabels.size > 0) {
    provenance.sourceLabels = Array.from(sourceLabels)
  }

  return provenance
}
