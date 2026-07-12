import type { ProviderRuntimeConfig } from '../config/llmConfig'
import { z } from 'zod'
import { LlmError } from './errors'
import type { LlmProvider } from './provider'
import { fetchWithTimeout, readJson, requireOk } from './providerHttp'
import { buildSuggestionPrompt } from './promptBuilder'
import { parseSuggestionResponse } from './responseParser'

const ENDPOINT = 'https://api.openai.com/v1'
const CompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }).passthrough() }).passthrough())
}).passthrough()

function headers(apiKey?: string): HeadersInit {
  if (!apiKey) throw new LlmError('CREDENTIAL_NOT_CONFIGURED', 'OpenAI API key is not configured.')
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

export function createOpenAiProvider(config: ProviderRuntimeConfig): LlmProvider {
  return {
    id: 'openai', label: 'OpenAI', mode: 'cloud',
    async testConnection() {
      const response = await fetchWithTimeout(`${ENDPOINT}/models/${encodeURIComponent(config.model)}`, {
        method: 'GET', headers: headers(config.apiKey)
      }, config.timeoutMs)
      await requireOk(response, 'OpenAI')
      return { available: true, label: 'OpenAI', details: 'Connected.', model: config.model }
    },
    async generateFieldSuggestions(input) {
      if (input.privacyMode !== 'cloud-opt-in') throw new LlmError('CLOUD_MODE_DISABLED', 'Cloud mode requires explicit opt-in.')
      const prompt = buildSuggestionPrompt(input)
      const response = await fetchWithTimeout(`${ENDPOINT}/chat/completions`, {
        method: 'POST', headers: headers(config.apiKey), body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          response_format: { type: 'json_object' }, temperature: 0
        })
      }, config.timeoutMs)
      await requireOk(response, 'OpenAI')
      const data = CompletionSchema.parse(await readJson(response, 'OpenAI'))
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new LlmError('INVALID_JSON', 'OpenAI returned an empty response.')
      return { response: parseSuggestionResponse(content), rawText: content, model: config.model }
    }
  }
}
