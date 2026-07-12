import type { ProviderRuntimeConfig } from '../config/llmConfig'
import { z } from 'zod'
import { LlmError } from './errors'
import type { LlmProvider } from './provider'
import { fetchWithTimeout, readJson, requireOk } from './providerHttp'
import { buildSuggestionPrompt } from './promptBuilder'
import { parseSuggestionResponse } from './responseParser'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MessageSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
}).passthrough()

function headers(apiKey?: string): HeadersInit {
  if (!apiKey) throw new LlmError('CREDENTIAL_NOT_CONFIGURED', 'Anthropic API key is not configured.')
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
}

async function request(config: ProviderRuntimeConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const response = await fetchWithTimeout(ENDPOINT, {
    method: 'POST', headers: headers(config.apiKey), body: JSON.stringify({
      model: config.model, max_tokens: maxTokens, temperature: 0, system,
      messages: [{ role: 'user', content: user }]
    })
  }, config.timeoutMs)
  await requireOk(response, 'Anthropic')
  const data = MessageSchema.parse(await readJson(response, 'Anthropic'))
  const text = data.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n').trim()
  if (!text) throw new LlmError('INVALID_JSON', 'Anthropic returned no text content.')
  return text
}

export function createAnthropicProvider(config: ProviderRuntimeConfig): LlmProvider {
  return {
    id: 'anthropic', label: 'Anthropic Claude', mode: 'cloud',
    async testConnection() {
      await request(config, 'Return only OK.', 'Connection test. Do not return JSON.', 8)
      return { available: true, label: 'Anthropic Claude', details: 'Connected.', model: config.model }
    },
    async generateFieldSuggestions(input) {
      if (input.privacyMode !== 'cloud-opt-in') throw new LlmError('CLOUD_MODE_DISABLED', 'Cloud mode requires explicit opt-in.')
      const prompt = buildSuggestionPrompt(input)
      const content = await request(config, prompt.system, prompt.user, 4096)
      return { response: parseSuggestionResponse(content), rawText: content, model: config.model }
    }
  }
}
