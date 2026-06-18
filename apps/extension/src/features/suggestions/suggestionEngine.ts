import { getDefaultLlmConfig, mergeLlmConfig } from '../../lib/config/llmConfig'
import { createProviderRegistry, getProviderMode } from '../../lib/llm/providerRegistry'
import { LlmError } from '../../lib/llm/errors'
import { minimizeFields, minimizeKnowledgeSnippets } from '../../lib/privacy/dataMinimization'
import { runPromptInjectionGuards } from '../../lib/privacy/promptInjectionGuards'
import { applySensitiveDataPolicy } from '../../lib/privacy/sensitiveDataPolicy'
import type { LlmProviderRegistry } from '../../lib/llm/providerRegistry'
import type { LlmConfig } from '../../lib/config/llmConfig'
import type { GenerateSuggestionsForPageInput, SuggestionGenerationResult } from './suggestionTypes'
import { createDefaultKnowledgeRetriever } from './knowledgeRetriever'
import type { KnowledgeRetriever } from './knowledgeRetriever'
import { mapProviderSuggestions, normalizeFormFields } from './suggestionMapping'

export interface SuggestionEngineDependencies {
  providerRegistry?: LlmProviderRegistry
  knowledgeRetriever?: KnowledgeRetriever
  config?: LlmConfig
}

export function createSuggestionEngine(deps: SuggestionEngineDependencies = {}) {
  const baseConfig = deps.config ?? getDefaultLlmConfig()
  const knowledgeRetriever = deps.knowledgeRetriever ?? createDefaultKnowledgeRetriever()

  return {
    async generateSuggestionsForPage(
      input: GenerateSuggestionsForPageInput
    ): Promise<SuggestionGenerationResult> {
      if (!input.activeProfileId) {
        throw new LlmError('NO_ACTIVE_PROFILE', 'No active profile selected.')
      }

      const fields = normalizeFormFields(input.fields)
      const profile = await knowledgeRetriever.getProfile(input.activeProfileId)
      if (!profile) {
        throw new LlmError('NO_ACTIVE_PROFILE', 'Active profile not found.')
      }

      const rawSnippets = await knowledgeRetriever.getRelevantSnippets({
        profileId: input.activeProfileId,
        fields,
        maxSnippets: baseConfig.requestLimits.maxKnowledgeSnippets
      })

      if (rawSnippets.length === 0) {
        throw new LlmError('NO_KNOWLEDGE_SNIPPETS', 'No relevant knowledge snippets found.')
      }

      const guardResult = runPromptInjectionGuards(fields)
      const providerMode = getProviderMode(input.providerId)

      if (guardResult.severity === 'high' && providerMode === 'cloud') {
        throw new LlmError(
          'PROMPT_INJECTION_DETECTED',
          'Suspicious prompt injection patterns detected. Cloud mode blocked.'
        )
      }

      const policyResult = applySensitiveDataPolicy(rawSnippets, {
        providerMode,
        privacyMode: input.privacyMode,
        promptInjectionDetected: guardResult.hasSuspiciousFields
      })

      const minimizedSnippets = minimizeKnowledgeSnippets(
        policyResult.allowedSnippets,
        baseConfig.requestLimits.maxKnowledgeSnippets
      )
      if (minimizedSnippets.length === 0) {
        throw new LlmError('NO_KNOWLEDGE_SNIPPETS', 'All knowledge snippets were filtered out.')
      }

      const minimizedFields = minimizeFields(
        fields,
        baseConfig.requestLimits.maxFieldsPerRequest
      )

      if (input.providerId === 'openai' && input.privacyMode !== 'cloud-opt-in') {
        throw new LlmError(
          'CLOUD_MODE_DISABLED',
          'Cloud mode is disabled. Enable opt-in to use OpenAI.'
        )
      }

      const resolvedConfig = mergeLlmConfig(baseConfig, {
        openai: {
          cloudEnabled: input.privacyMode === 'cloud-opt-in'
        }
      })

      const registry = deps.providerRegistry ?? createProviderRegistry(resolvedConfig)
      const provider = registry.getProvider(input.providerId)

      const providerResponse = await provider.generateFieldSuggestions({
        pageContext: input.pageContext,
        activeProfile: profile,
        fields: minimizedFields,
        knowledgeSnippets: minimizedSnippets,
        privacyMode: input.privacyMode,
        providerId: input.providerId,
        injectionWarnings: guardResult.warnings
      })

      const suggestions = mapProviderSuggestions({
        providerSuggestions: providerResponse.response.suggestions,
        fields: minimizedFields,
        knowledgeSnippets: minimizedSnippets,
        activeProfileId: profile.id,
        fieldWarnings: guardResult.fieldWarnings
      })

      const warnings = [
        ...guardResult.warnings,
        ...policyResult.warnings,
        ...providerResponse.response.warnings.map((message: string) => ({
          code: 'PROVIDER_WARNING',
          message
        }))
      ]

      return {
        suggestions,
        provider: {
          id: provider.id,
          mode: provider.mode,
          model: providerResponse.model
        },
        warnings,
        metadata: {
          generatedAt: new Date().toISOString(),
          activeProfileId: profile.id,
          fieldsReceived: fields.length,
          suggestionsReturned: suggestions.length,
          knowledgeSnippetsUsed: minimizedSnippets.length
        }
      }
    }
  }
}

export async function generateSuggestionsForPage(
  input: GenerateSuggestionsForPageInput,
  deps?: SuggestionEngineDependencies
): Promise<SuggestionGenerationResult> {
  return createSuggestionEngine(deps).generateSuggestionsForPage(input)
}
