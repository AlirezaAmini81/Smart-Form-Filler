import { describe, it, expect } from 'vitest'
import { minimizeKnowledgeSnippets } from '../../apps/extension/src/lib/privacy/dataMinimization'
import type { RetrievedKnowledgeSnippet } from '../../apps/extension/src/features/suggestions/suggestionTypes'

describe('dataMinimization', () => {
  it('drops unrelated snippets with zero score', () => {
    const snippets: RetrievedKnowledgeSnippet[] = [
      {
        id: 'unrelated',
        profileId: 'profile',
        label: 'unrelated',
        value: 'n/a',
        summary: 'n/a',
        tags: ['none'],
        sourceId: 'source_manual',
        sourceLabel: 'Manual',
        sensitivity: 'normal',
        score: 0
      },
      {
        id: 'related',
        profileId: 'profile',
        label: 'email',
        value: 'a@b.com',
        summary: 'email',
        tags: ['email'],
        sourceId: 'source_manual',
        sourceLabel: 'Manual',
        sensitivity: 'normal',
        score: 2
      }
    ]

    const minimized = minimizeKnowledgeSnippets(snippets, 5)
    expect(minimized).toHaveLength(1)
    expect(minimized[0].id).toBe('related')
  })
})
