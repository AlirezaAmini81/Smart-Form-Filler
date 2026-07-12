import { describe, it, expect } from 'vitest'
import { createInMemoryKnowledgeRetriever } from '../../apps/extension/src/features/suggestions/knowledgeRetriever'
import { DEFAULT_ENTRIES, DEFAULT_PROFILE } from '../../apps/extension/src/features/suggestions/knowledgeDefaults'
import { normalizeFormFields } from '../../apps/extension/src/features/suggestions/suggestionMapping'

describe('knowledgeRetriever', () => {
  it('provides the configured demo profile data', () => {
    const values = Object.fromEntries(DEFAULT_ENTRIES.map((entry) => [entry.label, entry.value]))

    expect(DEFAULT_PROFILE.name).toBe('Benedikt Peterson')
    expect(values).toMatchObject({
      'full name': 'Benedikt Peterson',
      salutation: 'Herr',
      gender: 'männlich',
      'email address': 'ben@gmail.com',
      'phone number': '+124712794798',
      'street address': 'Hauptstr. 1',
      'postal code': '13344',
      city: 'Berlin'
    })
  })

  it('scores label matches and returns top snippets', async () => {
    const retriever = createInMemoryKnowledgeRetriever({
      profiles: [{ id: 'profile_test', name: 'Test', sensitivity: 'normal' }],
      entries: [
        {
          id: 'entry_email',
          profileId: 'profile_test',
          label: 'email address',
          value: 'ada@example.com',
          summary: 'Primary email',
          tags: ['email'],
          sourceId: 'source_manual',
          sourceLabel: 'Manual',
          sensitivity: 'normal'
        },
        {
          id: 'entry_address',
          profileId: 'profile_test',
          label: 'address',
          value: '123 Main',
          summary: 'Home address',
          tags: ['address'],
          sourceId: 'source_manual',
          sourceLabel: 'Manual',
          sensitivity: 'normal'
        }
      ]
    })

    const fields = normalizeFormFields([
      {
        id: 'email',
        name: 'email',
        label: 'Email',
        kind: 'input'
      }
    ])

    const snippets = await retriever.getRelevantSnippets({
      profileId: 'profile_test',
      fields,
      maxSnippets: 2
    })

    expect(snippets[0].id).toBe('entry_email')
  })
})
