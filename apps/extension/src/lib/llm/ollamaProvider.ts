import type { LlmConfig } from '../config/llmConfig'
import { LlmError } from './errors'
import type { LlmProvider } from './provider'
import { buildSuggestionPrompt } from './promptBuilder'
import { parseSuggestionResponse } from './responseParser'

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmError('TIMEOUT', 'Ollama request timed out.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function createOllamaProvider(config: LlmConfig): LlmProvider {
  const endpoint = config.ollama.endpoint
  const model = config.ollama.model
  const timeoutMs = config.ollama.timeoutMs

  return {
    id: 'ollama',
    label: 'Ollama local',
    mode: 'local',
    async getStatus() {
      try {
        const response = await fetchWithTimeout(
          `${endpoint}/api/tags`,
          { method: 'GET' },
          timeoutMs
        )

        if (!response.ok) {
          return {
            available: false,
            label: 'Ollama local',
            details: 'Ollama responded with an error.'
          }
        }

        const data = (await response.json()) as { models?: Array<{ name: string }> }
        const models = data.models ?? []
        const hasModel = models.some((entry) => entry.name === model)

        return {
          available: hasModel,
          label: 'Ollama local',
          details: hasModel ? 'Model available.' : `Model ${model} not installed.`,
          model
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
        injectionWarnings: input.injectionWarnings
      })

      let response: Response
      try {
        response = await fetchWithTimeout(
          `${endpoint}/api/generate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt: prompt.fullPrompt,
              stream: false
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
        const errorPayload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null
        if (errorPayload?.error?.toLowerCase().includes('model')) {
          throw new LlmError('OLLAMA_MODEL_MISSING', `Ollama model ${model} not available.`)
        }
        throw new LlmError('PROVIDER_UNAVAILABLE', 'Ollama returned an error response.')
      }

      let data: { response?: string; error?: string }
      try {
        data = (await response.json()) as { response?: string; error?: string }
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
