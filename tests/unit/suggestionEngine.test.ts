import { describe, it, expect } from 'vitest'
import { createSuggestionEngine } from '../../apps/extension/src/features/suggestions/suggestionEngine'
import { createInMemoryKnowledgeRetriever } from '../../apps/extension/src/features/suggestions/knowledgeRetriever'
import { createMockFormFields } from '../../apps/extension/src/features/suggestions/suggestionMapping'
import type { LlmProviderRegistry } from '../../apps/extension/src/lib/llm/providerRegistry'
import type { LlmProvider } from '../../apps/extension/src/lib/llm/provider'

describe('suggestionEngine', () => {
  it('returns suggestions with confirmation required', async () => {
    const retriever = createInMemoryKnowledgeRetriever({
      profiles: [{ id: 'profile_demo', name: 'Demo', sensitivity: 'normal' }],
      entries: [
        {
          id: 'entry_full_name',
          profileId: 'profile_demo',
          label: 'full name',
          value: 'Ada Lovelace',
          summary: 'Primary name',
          tags: ['name'],
          sourceId: 'source_manual',
          sourceLabel: 'Manual',
          sensitivity: 'normal'
        }
      ]
    })

    const provider: LlmProvider = {
      id: 'ollama',
      label: 'Test provider',
      mode: 'local',
      async getStatus() {
        return { available: true, label: 'Test provider' }
      },
      async generateFieldSuggestions(input) {
        return {
          response: {
            suggestions: input.fields.map((field) => ({
              fieldId: field.id,
              suggestedValue: 'Ada Lovelace',
              valueType: 'direct-copy',
              confidence: 'high',
              reasoningSummary: 'Test suggestion',
              knowledgeEntryIds: ['entry_full_name'],
              sourceIds: ['source_manual'],
              sensitivity: 'normal',
              requiresUserConfirmation: true,
              warnings: []
            })),
            warnings: []
          },
          model: 'test-model'
        }
      }
    }

    const registry: LlmProviderRegistry = {
      getProvider() {
        return provider
      },
      listProviders() {
        return [provider]
      },
      async getProviderStatuses() {
        return {
          ollama: {
            available: true,
            label: 'Test provider'
          },
          openai: {
            available: false,
            label: 'OpenAI proxy',
            details: 'Disabled in test.'
          }
        }
      }
    }

    const engine = createSuggestionEngine({ knowledgeRetriever: retriever, providerRegistry: registry })
    const result = await engine.generateSuggestionsForPage({
      pageContext: { url: 'https://example.com', title: 'Test' },
      fields: createMockFormFields(),
      activeProfileId: 'profile_demo',
      providerId: 'ollama',
      privacyMode: 'local-only'
    })

    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.every((item) => item.requiresUserConfirmation)).toBe(true)
    expect(result.metadata.suggestionsReturned).toBe(result.suggestions.length)
  })
})
