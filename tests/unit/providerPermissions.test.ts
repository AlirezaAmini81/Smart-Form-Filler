import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { providerOriginPattern, validateOllamaEndpoint } from '../../apps/extension/src/lib/llm/providerCatalog'

describe('provider host permissions', () => {
  it('uses fixed cloud origins and validated loopback Ollama origins', () => {
    expect(providerOriginPattern('openai')).toBe('https://api.openai.com/*')
    expect(providerOriginPattern('anthropic')).toBe('https://api.anthropic.com/*')
    expect(providerOriginPattern('mistral')).toBe('https://api.mistral.ai/*')
    expect(providerOriginPattern('ollama', 'http://127.0.0.1:11434')).toBe('http://127.0.0.1/*')
    expect(() => validateOllamaEndpoint('https://attacker.example')).toThrow('loopback')
  })

  it('declares only optional provider origins without obsolete proxy or broad HTTPS access', () => {
    const manifest = JSON.parse(readFileSync('apps/extension/public/manifest.json', 'utf8')) as { host_permissions?: string[]; optional_host_permissions: string[] }
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.optional_host_permissions).not.toContain('https://*/*')
    expect(JSON.stringify(manifest)).not.toContain('8787')
  })

  it('keeps credential operations out of the content-script boundary', () => {
    const contentSource = readFileSync('apps/extension/src/content/index.ts', 'utf8')
    expect(contentSource).not.toMatch(/CREDENTIAL|apiKey|authorization|x-api-key/i)
  })
})
