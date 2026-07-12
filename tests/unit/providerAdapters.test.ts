import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRuntimeConfig } from '../../apps/extension/src/lib/config/llmConfig'
import type { SuggestionGenerationInput } from '../../apps/extension/src/features/suggestions/suggestionTypes'
import { createOpenAiProvider } from '../../apps/extension/src/lib/llm/openaiProvider'
import { createAnthropicProvider } from '../../apps/extension/src/lib/llm/anthropicProvider'
import { createMistralProvider } from '../../apps/extension/src/lib/llm/mistralProvider'
import { createOllamaProvider } from '../../apps/extension/src/lib/llm/ollamaProvider'

const mapping = JSON.stringify({ suggestions: [{ fieldId: 'name', suggestedValue: 'Ada', valueType: 'direct-copy', confidence: 'high', reasoningSummary: 'match', knowledgeEntryIds: ['entry_name'], sourceIds: ['source'], sensitivity: 'normal', requiresUserConfirmation: true, warnings: [] }], warnings: [] })
const input: SuggestionGenerationInput = {
  pageContext: { url: 'https://example.test', title: 'Form' },
  activeProfile: { id: 'profile', name: 'Ada', sensitivity: 'normal' },
  fields: [{ id: 'name', label: 'Name', kind: 'input' }],
  knowledgeSnippets: [{ id: 'entry_name', profileId: 'profile', label: 'Name', value: 'Ada', sourceId: 'source', sensitivity: 'normal', score: 1 }],
  privacyMode: 'cloud-opt-in', providerId: 'openai', suggestionMode: 'full-context'
}
const config = (providerId: ProviderRuntimeConfig['providerId']): ProviderRuntimeConfig => ({ providerId, model: 'test-model', apiKey: 'secret-test-key', endpoint: 'http://localhost:11434', timeoutMs: 1000 })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('provider adapters', () => {
  it('calls OpenAI directly with bearer auth and validates output', async () => {
    const fetchMock = vi.fn(async (_url: string, _request?: RequestInit) => json({ choices: [{ message: { content: mapping } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createOpenAiProvider(config('openai')).generateFieldSuggestions(input)
    const [url, request] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((request!.headers as Record<string, string>).Authorization).toBe('Bearer secret-test-key')
    expect(JSON.parse(request!.body as string)).toMatchObject({ model: 'test-model', response_format: { type: 'json_object' } })
    expect(result.response.suggestions[0].suggestedValue).toBe('Ada')
  })

  it.each([[401, 'INVALID_CREDENTIAL'], [429, 'RATE_LIMITED']])('maps OpenAI HTTP %i safely', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'failure' }, status)))
    await expect(createOpenAiProvider(config('openai')).generateFieldSuggestions(input)).rejects.toMatchObject({ code })
  })

  it('rejects malformed OpenAI output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: '{}' } }] })))
    await expect(createOpenAiProvider(config('openai')).generateFieldSuggestions(input)).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_ERROR' })
  })

  it('uses Anthropic headers and content-block extraction', async () => {
    const fetchMock = vi.fn(async (_url: string, _request?: RequestInit) => json({ content: [{ type: 'text', text: mapping }] }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createAnthropicProvider(config('anthropic')).generateFieldSuggestions({ ...input, providerId: 'anthropic' })
    const [url, request] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(request!.headers).toMatchObject({ 'x-api-key': 'secret-test-key', 'anthropic-version': '2023-06-01' })
    expect(result.response.suggestions[0].fieldId).toBe('name')
  })

  it.each([401, 200])('fails safely for Anthropic invalid or malformed response (%i)', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(status === 401 ? { error: 'bad key' } : { content: [{ type: 'text', text: '{}' }] }, status)))
    await expect(createAnthropicProvider(config('anthropic')).generateFieldSuggestions({ ...input, providerId: 'anthropic' })).rejects.toBeInstanceOf(Error)
  })

  it('uses Mistral bearer auth and validates normalized output', async () => {
    const fetchMock = vi.fn(async (_url: string, _request?: RequestInit) => json({ choices: [{ message: { content: mapping } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createMistralProvider(config('mistral')).generateFieldSuggestions({ ...input, providerId: 'mistral' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.mistral.ai/v1/chat/completions')
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer secret-test-key')
    expect(result.response.suggestions[0].suggestedValue).toBe('Ada')
  })

  it.each([401, 200])('fails safely for Mistral invalid or malformed response (%i)', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(status === 401 ? { error: 'bad key' } : { choices: [{ message: { content: '{}' } }] }, status)))
    await expect(createMistralProvider(config('mistral')).generateFieldSuggestions({ ...input, providerId: 'mistral' })).rejects.toBeInstanceOf(Error)
  })

  it('preserves configurable Ollama endpoint and reports unreachable endpoints', async () => {
    const fetchMock = vi.fn(async (_url: string, _request?: RequestInit) => json({ response: mapping }))
    vi.stubGlobal('fetch', fetchMock)
    await createOllamaProvider(config('ollama')).generateFieldSuggestions({ ...input, providerId: 'ollama', privacyMode: 'local-only' })
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:11434/api/generate')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(createOllamaProvider(config('ollama')).generateFieldSuggestions({ ...input, providerId: 'ollama', privacyMode: 'local-only' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})
