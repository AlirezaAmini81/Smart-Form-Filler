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
      throw new LlmError('TIMEOUT', 'OpenAI proxy request timed out.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function createOpenAiProvider(config: LlmConfig): LlmProvider {
  const proxyUrl = config.openai.proxyUrl
  const timeoutMs = config.openai.timeoutMs

  return {
    id: 'openai',
    label: 'OpenAI proxy',
    mode: 'cloud',
    async getStatus() {
      if (!config.openai.cloudEnabled) {
        return {
          available: false,
          label: 'OpenAI proxy',
          details: 'Cloud mode disabled.'
        }
      }

      try {
        const response = await fetchWithTimeout(
          `${proxyUrl}/api/llm/status`,
          { method: 'GET' },
          timeoutMs
        )

        if (!response.ok) {
          return {
            available: false,
            label: 'OpenAI proxy',
            details: 'Proxy responded with an error.'
          }
        }

        const data = (await response.json()) as { ok?: boolean; model?: string; error?: string }
        if (!data.ok) {
          return {
            available: false,
            label: 'OpenAI proxy',
            details: data.error ?? 'Proxy not ready.'
          }
        }

        return {
          available: true,
          label: 'OpenAI proxy',
          details: 'Proxy ready.',
          model: data.model
        }
      } catch (error) {
        return {
          available: false,
          label: 'OpenAI proxy',
          details: 'Proxy unreachable.'
        }
      }
    },
    async generateFieldSuggestions(input) {
      if (input.privacyMode !== 'cloud-opt-in') {
        throw new LlmError('CLOUD_MODE_DISABLED', 'Cloud mode requires explicit opt-in.')
      }

      if (!config.openai.cloudEnabled) {
        throw new LlmError('CLOUD_MODE_DISABLED', 'Cloud mode is disabled by default.')
      }

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
          `${proxyUrl}/api/llm/suggestions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system: prompt.system,
              user: prompt.user,
              schemaVersion: prompt.schemaVersion
            })
          },
          timeoutMs
        )
      } catch (error) {
        if (error instanceof LlmError) {
          throw error
        }
        throw new LlmError('OPENAI_PROXY_UNAVAILABLE', 'OpenAI proxy is not reachable.')
      }

      let data: unknown
      try {
        data = await response.json()
      } catch (error) {
        throw new LlmError('INVALID_JSON', 'Proxy returned invalid JSON.')
      }

      if (!response.ok) {
        const message =
          typeof data === 'object' && data && 'error' in data
            ? String((data as { error?: string }).error)
            : 'OpenAI proxy error.'

        if (message.includes('OPENAI_API_KEY_MISSING')) {
          throw new LlmError('OPENAI_API_KEY_MISSING', 'OpenAI API key is missing.')
        }

        throw new LlmError('PROVIDER_UNAVAILABLE', message)
      }

      if (typeof data === 'object' && data && 'error' in data) {
        throw new LlmError('PROVIDER_UNAVAILABLE', String((data as { error?: string }).error))
      }

      const parsed = parseSuggestionResponse(data)
      return {
        response: parsed
      }
    }
  }
}
