import { describe, expect, it, vi } from 'vitest'
import { createSuggestionEngine } from '../../apps/extension/src/features/suggestions/suggestionEngine'
import { createInMemoryKnowledgeRetriever } from '../../apps/extension/src/features/suggestions/knowledgeRetriever'
import { DEFAULT_ENTRIES, DEFAULT_PROFILE } from '../../apps/extension/src/features/suggestions/knowledgeDefaults'
import type { LlmProviderRegistry } from '../../apps/extension/src/lib/llm/providerRegistry'

function createEmptyProviderRegistry(): LlmProviderRegistry {
  const provider = {
    id: 'ollama' as const,
    label: 'Test provider',
    mode: 'local' as const,
    testConnection: vi.fn(async () => ({ available: true, label: 'Test provider' })),
    generateFieldSuggestions: vi.fn(async () => ({
      response: { suggestions: [], warnings: [] },
      model: 'test'
    }))
  }

  return {
    getProvider: vi.fn(() => provider),
    listProviders: vi.fn(() => [provider]),
    getProviderStatuses: vi.fn(async () => ({
      ollama: { available: true, label: 'Test provider' },
      openai: { available: false, label: 'OpenAI' },
      anthropic: { available: false, label: 'Anthropic Claude' },
      mistral: { available: false, label: 'Mistral' }
    }))
  }
}

describe('German contact suggestions', () => {
  it('deterministically maps required contact fields and resolves Anrede from gender options', async () => {
    const engine = createSuggestionEngine({
      providerRegistry: createEmptyProviderRegistry(),
      knowledgeRetriever: createInMemoryKnowledgeRetriever()
    })

    const result = await engine.generateSuggestionsForPage({
      pageContext: { url: 'https://example.test/apply', title: 'Stammdaten' },
      activeProfileId: DEFAULT_PROFILE.id,
      providerId: 'ollama',
      privacyMode: 'local-only',
      suggestionMode: 'deterministic-only',
      fields: [
        { locator: 'anrede-locator', id: 'anrede', label: 'Anrede *', kind: 'select', options: ['männlich', 'weiblich', 'divers'] },
        { id: 'vorname', label: 'Vorname *', kind: 'input' },
        { id: 'nachname', label: 'Nachname *', kind: 'input' },
        { id: 'strasse', label: 'Straße', kind: 'input' },
        { id: 'plz', label: 'PLZ', kind: 'input' },
        { id: 'ort', label: 'Ort', kind: 'input' },
        { id: 'telefon', label: 'Telefon *', type: 'tel', kind: 'input' },
        { id: 'email', label: 'E-Mail *', type: 'email', kind: 'input' }
      ]
    })

    const suggestions = Object.fromEntries(
      result.suggestions.map((suggestion) => [suggestion.fieldId, suggestion])
    )

    expect(suggestions.telefon).toMatchObject({
      suggestedValue: '+124712794798',
      sensitivity: 'sensitive',
      requiresUserConfirmation: true
    })
    expect(suggestions.email).toMatchObject({
      suggestedValue: 'ben@gmail.com',
      sensitivity: 'sensitive',
      requiresUserConfirmation: true
    })
    expect(suggestions.anrede).toMatchObject({
      suggestedValue: 'männlich',
      sensitivity: 'sensitive',
      fieldLocator: 'anrede-locator',
      requiresUserConfirmation: true
    })
    expect(suggestions.anrede.suggestedValue).not.toBe('Herr')
    expect(Object.keys(suggestions)).toEqual(expect.arrayContaining([
      'vorname', 'nachname', 'strasse', 'plz', 'ort'
    ]))
  })

  it('maps an English salutation to the Cornelsen gender select', async () => {
    const engine = createSuggestionEngine({
      knowledgeRetriever: createInMemoryKnowledgeRetriever({
        profiles: [DEFAULT_PROFILE],
        entries: [{
          id: 'entry_salutation_synthetic',
          profileId: DEFAULT_PROFILE.id,
          label: 'salutation',
          value: 'Mr.',
          sourceId: 'source_synthetic',
          sensitivity: 'normal'
        }]
      })
    })

    const result = await engine.generateSuggestionsForPage({
      pageContext: { url: 'https://example.test/apply', title: 'Application' },
      activeProfileId: DEFAULT_PROFILE.id,
      providerId: 'ollama',
      privacyMode: 'local-only',
      suggestionMode: 'deterministic-only',
      fields: [{
        locator: 'cornelsen-gender-locator',
        id: 'gender',
        name: 'bewerbung_form[gender]',
        label: 'Anrede',
        title: 'Anrede',
        kind: 'select',
        options: ['---', 'Männlich', 'Weiblich', 'Divers', 'Ohne Angabe']
      }]
    })

    expect(result.suggestions[0]).toMatchObject({
      fieldLocator: 'cornelsen-gender-locator',
      suggestedValue: 'Männlich',
      confidence: 'high'
    })
  })

  it('prefers an explicit gender fact over a conflicting salutation', async () => {
    const engine = createSuggestionEngine({
      knowledgeRetriever: createInMemoryKnowledgeRetriever({
        profiles: [DEFAULT_PROFILE],
        entries: [
          { id: 'entry_gender_synthetic', profileId: DEFAULT_PROFILE.id, label: 'gender', value: 'non-binary', sourceId: 'source_synthetic', sensitivity: 'normal' },
          { id: 'entry_salutation_synthetic', profileId: DEFAULT_PROFILE.id, label: 'salutation', value: 'Mr.', sourceId: 'source_synthetic', sensitivity: 'normal' }
        ]
      })
    })

    const result = await engine.generateSuggestionsForPage({
      pageContext: { url: 'https://example.test/apply', title: 'Application' },
      activeProfileId: DEFAULT_PROFILE.id,
      providerId: 'ollama',
      privacyMode: 'local-only',
      suggestionMode: 'deterministic-only',
      fields: [{ id: 'gender', label: 'Anrede', kind: 'select', options: ['Männlich', 'Weiblich', 'Divers'] }]
    })

    expect(result.suggestions[0].suggestedValue).toBe('Divers')
    expect(result.suggestions[0].provenance.knowledgeEntryIds).toEqual(['entry_gender_synthetic'])
  })

  it.each([
    ['Telefonnummer', 'entry_personal_phone'],
    ['Mobil', 'entry_personal_phone'],
    ['Mobilnummer', 'entry_personal_phone'],
    ['Phone number', 'entry_personal_phone'],
    ['Telephone', 'entry_personal_phone'],
    ['Email', 'entry_personal_email'],
    ['E-Mail-Adresse', 'entry_personal_email'],
    ['Email address', 'entry_personal_email'],
    ['Mail', 'entry_personal_email']
  ])('retrieves the contact entry for %s', async (label, expectedId) => {
    const retriever = createInMemoryKnowledgeRetriever()
    const snippets = await retriever.getRelevantSnippets({
      profileId: DEFAULT_PROFILE.id,
      fields: [{ id: 'contact', label, kind: 'input' }],
      maxSnippets: DEFAULT_ENTRIES.length
    })

    expect(snippets[0].id).toBe(expectedId)
    expect(snippets[0].sensitivity).toBe('sensitive')
  })
})
