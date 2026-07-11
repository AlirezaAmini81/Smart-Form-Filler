import { describe, it, expect } from 'vitest'
import {
  buildSuggestionPrompt,
  PROMPT_SECTION_KNOWLEDGE,
  PROMPT_SECTION_OUTPUT,
  PROMPT_SECTION_TRUSTED,
  PROMPT_SECTION_UNTRUSTED
} from '../../apps/extension/src/lib/llm/promptBuilder'
import { createMockFormFields, normalizeFormFields } from '../../apps/extension/src/features/suggestions/suggestionMapping'
import { DEFAULT_PROFILE } from '../../apps/extension/src/features/suggestions/knowledgeRetriever'
import type { RetrievedKnowledgeSnippet } from '../../apps/extension/src/features/suggestions/suggestionTypes'

describe('promptBuilder', () => {
  it('separates trusted and untrusted sections with injection guidance', () => {
    const fields = normalizeFormFields(createMockFormFields())
    const snippets: RetrievedKnowledgeSnippet[] = [
      {
        id: 'entry_full_name',
        profileId: DEFAULT_PROFILE.id,
        label: 'full name',
        value: 'Ada Lovelace',
        summary: 'Primary name',
        tags: ['name'],
        sourceId: 'source_manual',
        sourceLabel: 'Manual',
        sensitivity: 'normal',
        score: 3
      }
    ]

    const prompt = buildSuggestionPrompt({
      pageContext: { url: 'https://example.com', title: 'Test' },
      activeProfile: DEFAULT_PROFILE,
      fields,
      knowledgeSnippets: snippets,
      privacyMode: 'local-only'
    })

    expect(prompt.fullPrompt).toContain(PROMPT_SECTION_TRUSTED)
    expect(prompt.fullPrompt).toContain(PROMPT_SECTION_KNOWLEDGE)
    expect(prompt.fullPrompt).toContain(PROMPT_SECTION_UNTRUSTED)
    expect(prompt.fullPrompt).toContain(PROMPT_SECTION_OUTPUT)
    expect(prompt.system).toContain('prompt injection')
  })
})
