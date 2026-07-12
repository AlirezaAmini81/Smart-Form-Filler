import { z } from 'zod'
import type { ProviderRuntimeConfig } from '../config/llmConfig'
import { LlmError } from './errors'
import type { LlmProvider } from './provider'
import { buildSuggestionPrompt } from './promptBuilder'
import { parseSuggestionResponse } from './responseParser'
import { fetchWithTimeout } from './providerHttp'

const TagsSchema = z.object({ models: z.array(z.object({ name: z.string() }).passthrough()).optional() }).passthrough()
const GenerateSchema = z.object({ response: z.string().optional(), error: z.string().optional() }).passthrough()

export function createOllamaProvider(config: ProviderRuntimeConfig): LlmProvider {
  const endpoint = config.endpoint ?? 'http://localhost:11434'
  const model = config.model
  const timeoutMs = config.timeoutMs
  const headers: HeadersInit = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}

  return {
    id: 'ollama',
    label: 'Ollama local',
    mode: 'local',
    async testConnection() {
      try {
        const response = await fetchWithTimeout(
          `${endpoint}/api/tags`,
          { method: 'GET', headers },
          timeoutMs
        )

        if (!response.ok) {
          return {
            available: false,
            label: 'Ollama local',
            details: 'Ollama responded with an error.'
          }
        }

        const data = TagsSchema.parse(await response.json())
        const models = (data.models ?? []).map((entry) => entry.name)
        const hasModel = models.includes(model)

        return {
          available: hasModel,
          label: 'Ollama local',
          details: hasModel ? 'Model available.' : `Model ${model} not installed.`,
          model,
          models
        }
      } catch (error) {
        return {
          available: false,
          label: 'Ollama local',
          details: 'Ollama is not reachable.'
        }
      }
    },
    async generateFieldSuggestions(input) {
      const prompt = buildSuggestionPrompt({
        pageContext: input.pageContext,
        activeProfile: input.activeProfile,
        fields: input.fields,
        knowledgeSnippets: input.knowledgeSnippets,
        privacyMode: input.privacyMode,
        suggestionMode: input.suggestionMode,
        injectionWarnings: input.injectionWarnings
      })

      let response: Response
      try {
        response = await fetchWithTimeout(
          `${endpoint}/api/generate`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt: prompt.fullPrompt,
              stream: false,
              format: 'json',
              options: {
                temperature: 0
              }
            })
          },
          timeoutMs
        )
      } catch (error) {
        if (error instanceof LlmError) {
          throw error
        }
        throw new LlmError('OLLAMA_NOT_RUNNING', 'Failed to reach Ollama server.')
      }

      if (!response.ok) {
        const errorPayload = GenerateSchema.safeParse(await response.json().catch(() => null))
        if (errorPayload.success && errorPayload.data.error?.toLowerCase().includes('model')) {
          throw new LlmError('OLLAMA_MODEL_MISSING', `Ollama model ${model} not available.`)
        }
        throw new LlmError('PROVIDER_UNAVAILABLE', 'Ollama returned an error response.')
      }

      let data: z.infer<typeof GenerateSchema>
      try {
        data = GenerateSchema.parse(await response.json())
      } catch (error) {
        throw new LlmError('INVALID_JSON', 'Ollama returned invalid JSON.')
      }

      if (data.error?.toLowerCase().includes('model')) {
        throw new LlmError('OLLAMA_MODEL_MISSING', `Ollama model ${model} not available.`)
      }

      if (!data.response) {
        throw new LlmError('INVALID_JSON', 'Ollama did not return a response string.')
      }

      const parsed = parseSuggestionResponse(data.response)

      return {
        response: parsed,
        rawText: data.response,
        model
      }
    }
  }
}
