import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../apps/extension/src/features/suggestions/profileRepository'
import {
  CANONICAL_PROFILE_STORAGE_KEY,
  createProfileVault,
  LEGACY_KNOWLEDGE_STORAGE_KEY,
  PROFILE_VAULT_SESSION_KEY,
  PROFILE_VAULT_STORAGE_KEY,
  VaultAuthenticationError,
  VaultLockedError
} from '../../apps/extension/src/features/suggestions/profileVault'
import type { StoredKnowledgeBase } from '../../apps/extension/src/features/suggestions/knowledgeTypes'

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, unknown>()
  failSetKey: string | null = null

  constructor(initial: Record<string, unknown> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, structuredClone(value)))
  }

  async get(key: string): Promise<unknown> {
    return structuredClone(this.values.get(key) ?? null)
  }

  async getAll(): Promise<Record<string, unknown>> {
    return Object.fromEntries([...this.values].map(([key, value]) => [key, structuredClone(value)]))
  }

  async set(key: string, value: unknown): Promise<void> {
    if (key === this.failSetKey) throw new Error('synthetic write failure')
    this.values.set(key, structuredClone(value))
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }

  async removeMany(keys: string[]): Promise<void> {
    keys.forEach((key) => this.values.delete(key))
  }
}

function profile(): StoredKnowledgeBase {
  return {
    version: 1,
    updatedAt: '2026-07-12T10:00:00.000Z',
    profiles: [{ id: 'synthetic', name: 'Synthetic User', sensitivity: 'normal' }],
    entries: [{
      id: 'entry_email',
      profileId: 'synthetic',
      label: 'E-mail',
      value: 'synthetic@example.invalid',
      sourceId: 'source_test',
      sensitivity: 'sensitive'
    }]
  }
}

function vault(persistent = new MemoryStorage(), session = new MemoryStorage()) {
  return {
    persistent,
    session,
    service: createProfileVault({ persistentStorage: persistent, sessionStorage: session, iterations: 100_000 })
  }
}

describe('ProfileVault', () => {
  it('initializes an encrypted vault without persistent plaintext', async () => {
    const { service, persistent } = vault()

    await service.initialize('correct horse battery staple', profile())

    expect(await service.getStatus()).toBe('unlocked')
    expect(await service.readProfile()).toEqual(profile())
    expect(persistent.values.has(CANONICAL_PROFILE_STORAGE_KEY)).toBe(false)
    expect(JSON.stringify(persistent.values.get(PROFILE_VAULT_STORAGE_KEY))).not.toContain('synthetic@example.invalid')
  })

  it('uses a fresh IV and ciphertext for identical data', async () => {
    const first = vault()
    const second = vault()
    await first.service.initialize('same password', profile())
    await second.service.initialize('same password', profile())

    const firstEnvelope = first.persistent.values.get(PROFILE_VAULT_STORAGE_KEY) as { iv: string; ciphertext: string }
    const secondEnvelope = second.persistent.values.get(PROFILE_VAULT_STORAGE_KEY) as { iv: string; ciphertext: string }
    expect(firstEnvelope.iv).not.toBe(secondEnvelope.iv)
    expect(firstEnvelope.ciphertext).not.toBe(secondEnvelope.ciphertext)
  })

  it('unlocks with the correct password and rejects an incorrect password', async () => {
    const { service } = vault()
    await service.initialize('right password', profile())
    await service.lock()

    await expect(service.unlock('wrong password')).rejects.toBeInstanceOf(VaultAuthenticationError)
    await expect(service.unlock('right password')).resolves.toBeUndefined()
    await expect(service.readProfile()).resolves.toEqual(profile())
  })

  it.each(['ciphertext', 'iv', 'updatedAt'] as const)('detects modified %s', async (property) => {
    const { service, persistent, session } = vault()
    await service.initialize('right password', profile())
    await service.lock()
    const envelope = persistent.values.get(PROFILE_VAULT_STORAGE_KEY) as Record<string, unknown>
    if (property === 'updatedAt') envelope[property] = '2026-07-12T11:00:00.000Z'
    else {
      const encoded = envelope[property] as string
      envelope[property] = `${encoded[0] === 'A' ? 'B' : 'A'}${encoded.slice(1)}`
    }
    persistent.values.set(PROFILE_VAULT_STORAGE_KEY, envelope)
    session.values.clear()

    await expect(service.unlock('right password')).rejects.toBeInstanceOf(VaultAuthenticationError)
  })

  it('rejects reads and writes while locked and clears session key material', async () => {
    const { service, session } = vault()
    await service.initialize('right password', profile())
    expect(session.values.has(PROFILE_VAULT_SESSION_KEY)).toBe(true)

    await service.lock()

    expect(session.values.has(PROFILE_VAULT_SESSION_KEY)).toBe(false)
    await expect(service.readProfile()).rejects.toBeInstanceOf(VaultLockedError)
    await expect(service.writeProfile(profile())).rejects.toBeInstanceOf(VaultLockedError)
  })

  it('restores only within the same browser session and locks after a session reset', async () => {
    const persistent = new MemoryStorage()
    const session = new MemoryStorage()
    const first = createProfileVault({ persistentStorage: persistent, sessionStorage: session, iterations: 100_000 })
    await first.initialize('right password', profile())

    const continued = createProfileVault({ persistentStorage: persistent, sessionStorage: session, iterations: 100_000 })
    expect(await continued.getStatus()).toBe('unlocked')
    const restarted = createProfileVault({ persistentStorage: persistent, sessionStorage: new MemoryStorage(), iterations: 100_000 })
    expect(await restarted.getStatus()).toBe('locked')
  })

  it.each([
    ['canonical', CANONICAL_PROFILE_STORAGE_KEY],
    ['legacy knowledge base', LEGACY_KNOWLEDGE_STORAGE_KEY]
  ])('migrates %s plaintext and removes the source', async (_name, sourceKey) => {
    const persistent = new MemoryStorage({ [sourceKey]: profile() })
    const { service } = vault(persistent)

    expect(await service.getStatus()).toBe('migration-required')
    await service.migrate('migration password')

    expect(await service.readProfile()).toEqual(profile())
    expect(persistent.values.has(sourceKey)).toBe(false)
    expect(persistent.values.has(PROFILE_VAULT_STORAGE_KEY)).toBe(true)
    await expect(service.migrate('ignored after migration')).resolves.toBeUndefined()
  })

  it('migrates a legacy account-id record', async () => {
    const persistent = new MemoryStorage({
      synthetic_account: {
        accountId: 'synthetic_account',
        profileName: 'Synthetic User',
        email: 'synthetic@example.invalid',
        savedAt: '2026-07-12T10:00:00.000Z'
      }
    })
    const { service } = vault(persistent)

    await service.migrate('migration password')

    expect((await service.readProfile()).entries).toContainEqual(expect.objectContaining({
      label: 'email', value: 'synthetic@example.invalid'
    }))
    expect(persistent.values.has('synthetic_account')).toBe(false)
  })

  it('preserves plaintext when the encrypted write fails', async () => {
    const persistent = new MemoryStorage({ [CANONICAL_PROFILE_STORAGE_KEY]: profile() })
    persistent.failSetKey = PROFILE_VAULT_STORAGE_KEY
    const { service } = vault(persistent)

    await expect(service.migrate('migration password')).rejects.toMatchObject({ code: 'STORAGE_WRITE_FAILED' })
    expect(persistent.values.get(CANONICAL_PROFILE_STORAGE_KEY)).toEqual(profile())
    expect(persistent.values.has(PROFILE_VAULT_STORAGE_KEY)).toBe(false)
  })

  it('rejects malformed profiles and unsupported envelope versions', async () => {
    const first = vault()
    await expect(first.service.initialize('password', { ...profile(), profiles: [] } as never)).rejects.toThrow()

    const persistent = new MemoryStorage({ [PROFILE_VAULT_STORAGE_KEY]: { version: 2 } })
    const service = createProfileVault({ persistentStorage: persistent, iterations: 100_000 })
    await expect(service.unlock('password')).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' })
    expect(await service.getStatus()).toBe('corrupted')
  })

  it('changes the password using new key metadata while preserving profile data', async () => {
    const { service, persistent } = vault()
    await service.initialize('old password', profile())
    const oldEnvelope = structuredClone(persistent.values.get(PROFILE_VAULT_STORAGE_KEY)) as { kdf: { salt: string }; iv: string }

    await service.changePassword('old password', 'new password')
    await service.lock()

    await expect(service.unlock('old password')).rejects.toBeInstanceOf(VaultAuthenticationError)
    await service.unlock('new password')
    expect(await service.readProfile()).toEqual(profile())
    const newEnvelope = persistent.values.get(PROFILE_VAULT_STORAGE_KEY) as { kdf: { salt: string }; iv: string }
    expect(newEnvelope.kdf.salt).not.toBe(oldEnvelope.kdf.salt)
    expect(newEnvelope.iv).not.toBe(oldEnvelope.iv)
  })
})
