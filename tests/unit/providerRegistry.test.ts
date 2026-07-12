import { describe, expect, it } from 'vitest'
import { createProviderRegistry, getProviderMode } from '../../apps/extension/src/lib/llm/providerRegistry'
import { PROVIDER_CATALOG, PROVIDER_IDS, type ProviderId } from '../../apps/extension/src/lib/llm/providerCatalog'
import type { ProviderRuntimeConfig } from '../../apps/extension/src/lib/config/llmConfig'

const configs = Object.fromEntries(PROVIDER_IDS.map((providerId) => [providerId, {
  providerId, model: `model-${providerId}`, endpoint: providerId === 'ollama' ? 'http://localhost:11434' : undefined,
  apiKey: providerId === 'ollama' ? undefined : 'test-key', timeoutMs: 1000
}])) as Record<ProviderId, ProviderRuntimeConfig>

describe('provider registry', () => {
  it('registers and selects all four providers with provider-specific config', () => {
    const registry = createProviderRegistry(configs)
    expect(registry.listProviders().map(({ id }) => id)).toEqual(PROVIDER_IDS)
    for (const id of PROVIDER_IDS) expect(registry.getProvider(id).id).toBe(id)
    expect(getProviderMode('ollama')).toBe('local')
    expect(getProviderMode('anthropic')).toBe('cloud')
  })

  it('offers only curated small models while allowing settings to retain custom IDs', () => {
    expect(PROVIDER_CATALOG.openai.models.map(({ id }) => id)).toEqual([
      'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini', 'gpt-4.1-nano'
    ])
    expect(PROVIDER_CATALOG.anthropic.models.map(({ id }) => id)).toEqual([
      'claude-haiku-4-5', 'claude-sonnet-4-6'
    ])
    expect(PROVIDER_CATALOG.mistral.models.every(({ label }) => /Small|3B|8B/.test(label))).toBe(true)
    expect(PROVIDER_CATALOG.ollama.models.every(({ label }) => /1B|3B|4B/.test(label))).toBe(true)
  })

  it('rejects unknown providers', () => {
    expect(() => createProviderRegistry(configs).getProvider('unknown' as ProviderId)).toThrow('Unknown provider')
    expect(() => getProviderMode('unknown' as ProviderId)).toThrow('Unknown provider')
  })
})
