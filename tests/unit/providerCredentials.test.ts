import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../apps/extension/src/features/suggestions/profileRepository'
import { PROFILE_VAULT_SESSION_KEY } from '../../apps/extension/src/features/suggestions/profileVault'
import { deriveVaultKey, exportVaultKey } from '../../apps/extension/src/features/suggestions/profileVaultCrypto'
import { createProviderCredentialStore, maskCredential, PROVIDER_CREDENTIALS_STORAGE_KEY } from '../../apps/extension/src/features/providers/providerCredentialStore'

class MemoryStorage implements StorageAdapter {
  values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: unknown) { this.values.set(key, value) }
  async remove(key: string) { this.values.delete(key) }
}

async function unlockedSession(): Promise<MemoryStorage> {
  const session = new MemoryStorage()
  const key = await deriveVaultKey('test-password', new Uint8Array(16), 100_000)
  await session.set(PROFILE_VAULT_SESSION_KEY, { version: 1, key: await exportVaultKey(key), vaultCreatedAt: new Date(0).toISOString() })
  return session
}

async function setVaultKey(session: MemoryStorage, password: string): Promise<void> {
  const key = await deriveVaultKey(password, new Uint8Array(16), 100_000)
  await session.set(PROFILE_VAULT_SESSION_KEY, { version: 1, key: await exportVaultKey(key), vaultCreatedAt: new Date(0).toISOString() })
}

describe('provider credential store', () => {
  it('encrypts persistent keys, masks status, replaces, and deletes', async () => {
    const persistent = new MemoryStorage(); const store = createProviderCredentialStore(persistent, await unlockedSession())
    await store.saveCredential('openai', 'first-secret', 'persistent')
    expect(JSON.stringify(persistent.values.get(PROVIDER_CREDENTIALS_STORAGE_KEY))).not.toContain('first-secret')
    expect(await store.getStatus('openai')).toEqual({ configured: true, persistence: 'persistent', masked: '••••••••' })
    await store.saveCredential('openai', 'replacement-secret', 'persistent')
    expect(await store.getCredential('openai')).toBe('replacement-secret')
    await store.deleteCredential('openai')
    expect(await store.hasCredential('openai')).toBe(false)
    expect(persistent.values.has(PROVIDER_CREDENTIALS_STORAGE_KEY)).toBe(false)
  })

  it('supports session-only credentials and clears them on lock lifecycle', async () => {
    const session = new MemoryStorage(); const store = createProviderCredentialStore(new MemoryStorage(), session)
    await store.saveCredential('anthropic', 'session-secret', 'session')
    expect(await store.getCredential('anthropic')).toBe('session-secret')
    await store.clearSessionCredentials()
    await expect(store.getCredential('anthropic')).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_CONFIGURED' })
  })

  it('requires an unlocked vault for persistent save and never returns a full key in status', async () => {
    const store = createProviderCredentialStore(new MemoryStorage(), new MemoryStorage())
    await expect(store.saveCredential('mistral', 'secret', 'persistent')).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    expect(maskCredential(true)).toBe('••••••••')
  })

  it('re-encrypts persistent credentials across vault key rotation', async () => {
    const persistent = new MemoryStorage(); const session = await unlockedSession()
    const store = createProviderCredentialStore(persistent, session)
    await store.saveCredential('openai', 'rotated-secret', 'persistent')
    await store.prepareForVaultRekey()
    await setVaultKey(session, 'replacement-password')
    await store.completeVaultRekey()
    expect(await store.getCredential('openai')).toBe('rotated-secret')
    expect(JSON.stringify(persistent.values.get(PROVIDER_CREDENTIALS_STORAGE_KEY))).not.toContain('rotated-secret')
  })
})
