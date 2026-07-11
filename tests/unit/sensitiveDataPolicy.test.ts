import { describe, it, expect } from 'vitest'
import { applySensitiveDataPolicy } from '../../apps/extension/src/lib/privacy/sensitiveDataPolicy'
import type { RetrievedKnowledgeSnippet } from '../../apps/extension/src/features/suggestions/suggestionTypes'

describe('sensitiveDataPolicy', () => {
  it('blocks secret snippets in cloud mode', () => {
    const snippets: RetrievedKnowledgeSnippet[] = [
      {
        id: 'secret',
        profileId: 'profile',
        label: 'secret',
        value: 'secret',
        summary: 'secret',
        tags: ['secret'],
        sourceId: 'source_secret',
        sourceLabel: 'Secret',
        sensitivity: 'secret',
        score: 2
      },
      {
        id: 'normal',
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

    const result = applySensitiveDataPolicy(snippets, {
      providerMode: 'cloud',
      privacyMode: 'cloud-opt-in',
      promptInjectionDetected: false
    })

    expect(result.allowedSnippets).toHaveLength(1)
    expect(result.blockedSnippets).toHaveLength(1)
    expect(result.warnings.some((warning) => warning.code === 'SECRET_BLOCKED')).toBe(true)
  })

  it('blocks sensitive snippets when prompt injection is detected', () => {
    const snippets: RetrievedKnowledgeSnippet[] = [
      {
        id: 'sensitive',
        profileId: 'profile',
        label: 'passport',
        value: '123',
        summary: 'passport',
        tags: ['passport'],
        sourceId: 'source_sensitive',
        sourceLabel: 'Sensitive',
        sensitivity: 'sensitive',
        score: 2
      }
    ]

    const result = applySensitiveDataPolicy(snippets, {
      providerMode: 'local',
      privacyMode: 'local-only',
      promptInjectionDetected: true
    })

    expect(result.allowedSnippets).toHaveLength(0)
  })
})
