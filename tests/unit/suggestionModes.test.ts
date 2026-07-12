import { describe, expect, it, vi } from 'vitest'
import { createSuggestionEngine } from '../../apps/extension/src/features/suggestions/suggestionEngine'
import { createInMemoryKnowledgeRetriever } from '../../apps/extension/src/features/suggestions/knowledgeRetriever'
import type { LlmProviderRegistry } from '../../apps/extension/src/lib/llm/providerRegistry'
import type {
  ProviderSuggestion,
  SuggestionGenerationInput
} from '../../apps/extension/src/features/suggestions/suggestionTypes'
import type { KnowledgeEntry } from '../../apps/extension/src/features/suggestions/knowledgeTypes'

const PROFILE = { id: 'profile_test', name: 'Ada Lovelace', sensitivity: 'normal' as const }
const ENTRIES: KnowledgeEntry[] = [
  {
    id: 'entry_profession',
    profileId: PROFILE.id,
    label: 'Beruf',
    value: 'Student',
    sourceId: 'source_manual',
    sensitivity: 'normal'
  },
  {
    id: 'entry_name',
    profileId: PROFILE.id,
    label: 'Name',
    value: 'Ada Lovelace',
    sourceId: 'source_manual',
    sensitivity: 'normal'
  },
  {
    id: 'entry_birthdate',
    profileId: PROFILE.id,
    label: 'Geburtsdatum',
    value: '12/31/2000',
    sourceId: 'source_manual',
    sensitivity: 'sensitive'
  }
]

function providerSuggestion(overrides: Partial<ProviderSuggestion>): ProviderSuggestion {
  return {
    fieldId: 'field',
    suggestedValue: null,
    valueType: 'direct-copy',
    confidence: 'high',
    reasoningSummary: 'Mapped trusted profile entries.',
    knowledgeEntryIds: [],
    sourceIds: [],
    sensitivity: 'normal',
    requiresUserConfirmation: true,
    warnings: [],
    ...overrides
  }
}

function createRegistry(
  generate: (input: SuggestionGenerationInput) => Promise<{ response: { suggestions: ProviderSuggestion[]; warnings: string[] }; model: string }>
): { registry: LlmProviderRegistry; generate: ReturnType<typeof vi.fn> } {
  const generateMock = vi.fn(generate)
  const provider = {
    id: 'ollama' as const,
    label: 'Test provider',
    mode: 'local' as const,
    testConnection: vi.fn(async () => ({ available: true, label: 'Test provider' })),
    generateFieldSuggestions: generateMock
  }
  return {
    generate: generateMock,
    registry: {
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
}

function createEngine(registry: LlmProviderRegistry) {
  return createSuggestionEngine({
    providerRegistry: registry,
    knowledgeRetriever: createInMemoryKnowledgeRetriever({ profiles: [PROFILE], entries: ENTRIES })
  })
}

describe('suggestion modes', () => {
  it('lets full-context mode compose and format from multiple entries', async () => {
    const { registry, generate } = createRegistry(async () => ({
      response: {
        suggestions: [providerSuggestion({
          fieldId: 'summary',
          suggestedValue: 'Student, Ada Lovelace, 31/12/2000',
          valueType: 'generated',
          knowledgeEntryIds: ['entry_profession', 'entry_name', 'entry_birthdate'],
          sensitivity: 'sensitive'
        })],
        warnings: []
      },
      model: 'test'
    }))

    const result = await createEngine(registry).generateSuggestionsForPage({
      pageContext: { url: 'https://example.test', title: 'Application' },
      fields: [
        { id: 'summary', label: 'Profession, Name, birthdate (d/m/yyyy)', kind: 'input' },
        { id: 'documents', label: 'Bewerbungsunterlagen (komplett) *', type: 'file', kind: 'input' }
      ],
      activeProfileId: PROFILE.id,
      providerId: 'ollama',
      privacyMode: 'local-only',
      suggestionMode: 'full-context'
    })

    expect(generate).toHaveBeenCalledOnce()
    const providerInput = generate.mock.calls[0][0] as SuggestionGenerationInput
    expect(providerInput.fields.map((field) => field.id)).toEqual(['summary'])
    expect(providerInput.knowledgeSnippets.map((snippet) => snippet.id)).toEqual(
      expect.arrayContaining(['entry_profession', 'entry_name', 'entry_birthdate'])
    )
    expect(result.suggestions[0]).toMatchObject({
      suggestedValue: 'Student, Ada Lovelace, 31/12/2000',
      valueType: 'generated',
      requiresUserConfirmation: true
    })
    expect(result.suggestions[1]).toMatchObject({
      fieldId: 'documents',
      suggestedValue: null
    })
  })

  it('hydrates an identifier-only mapping locally even without lexical overlap', async () => {
    const { registry, generate } = createRegistry(async () => ({
      response: {
        suggestions: [providerSuggestion({
          fieldId: 'profession',
          suggestedValue: 'Invented provider value',
          knowledgeEntryIds: ['entry_profession']
        })],
        warnings: []
      },
      model: 'test'
    }))

    const result = await createEngine(registry).generateSuggestionsForPage({
      pageContext: { url: 'https://example.test', title: 'Application' },
      fields: [{ id: 'profession', label: 'Profession', kind: 'input' }],
      activeProfileId: PROFILE.id,
      providerId: 'ollama',
      privacyMode: 'local-only',
      suggestionMode: 'identifier-only'
    })

    expect(generate).toHaveBeenCalledOnce()
    expect(result.suggestions[0]).toMatchObject({
      fieldId: 'profession',
      suggestedValue: 'Student',
      valueType: 'direct-copy',
      requiresUserConfirmation: true
    })
  })

  it('never calls a provider in deterministic-only mode', async () => {
    const { registry, generate } = createRegistry(async () => {
      throw new Error('Provider must not be called')
    })

    const result = await createEngine(registry).generateSuggestionsForPage({
      pageContext: { url: 'https://example.test', title: 'Application' },
      fields: [{ id: 'profession', label: 'Profession', kind: 'input' }],
      activeProfileId: PROFILE.id,
      providerId: 'ollama',
      privacyMode: 'local-only',
      suggestionMode: 'deterministic-only'
    })

    expect(generate).not.toHaveBeenCalled()
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]).toMatchObject({
      fieldId: 'profession',
      fieldLabel: 'Profession',
      suggestedValue: null,
      confidence: 'low'
    })
    expect(result.provider.mode).toBe('none')
  })

  it('keeps deterministic secret matches local when cloud policy excludes them', async () => {
    const secretEntry: KnowledgeEntry = {
      id: 'entry_secret_email',
      profileId: PROFILE.id,
      label: 'email address',
      value: 'private@example.test',
      sourceId: 'source_secret',
      sensitivity: 'secret'
    }
    const { registry, generate } = createRegistry(async () => {
      throw new Error('Provider must not be called for an already resolved field')
    })
    const engine = createSuggestionEngine({
      providerRegistry: registry,
      knowledgeRetriever: createInMemoryKnowledgeRetriever({
        profiles: [PROFILE],
        entries: [secretEntry]
      })
    })

    const result = await engine.generateSuggestionsForPage({
      pageContext: { url: 'https://example.test', title: 'Application' },
      fields: [{ id: 'email', label: 'Email', type: 'email', kind: 'input' }],
      activeProfileId: PROFILE.id,
      providerId: 'openai',
      privacyMode: 'cloud-opt-in',
      suggestionMode: 'identifier-only'
    })

    expect(generate).not.toHaveBeenCalled()
    expect(result.suggestions[0]).toMatchObject({
      suggestedValue: 'private@example.test',
      sensitivity: 'secret'
    })
    expect(result.warnings.some((warning) => warning.code === 'SECRET_BLOCKED')).toBe(true)
  })
})
