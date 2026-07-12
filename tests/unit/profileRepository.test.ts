import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../apps/extension/src/features/suggestions/profileRepository'
import {
  createProfileRepository,
  PROFILE_STORAGE_KEY
} from '../../apps/extension/src/features/suggestions/profileRepository'
import type {
  KnowledgeEntry,
  StoredKnowledgeBase
} from '../../apps/extension/src/features/suggestions/knowledgeTypes'

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, unknown>()
  writes = 0
  failWrites = false

  constructor(initial: Record<string, unknown> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value))
  }

  async get(key: string): Promise<unknown> {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: unknown): Promise<void> {
    this.writes += 1
    if (this.failWrites) throw new Error('write failed')
    this.values.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }
}

function entry(profileId: string, label = 'E-mail', value = 'alice@example.com'): KnowledgeEntry {
  return {
    id: `entry_${label}`,
    profileId,
    label,
    value,
    sourceId: 'source_test',
    sensitivity: 'sensitive'
  }
}

function database(profileId = 'alice', entries = [entry(profileId)]): StoredKnowledgeBase {
  return {
    version: 1,
    updatedAt: '2026-07-12T10:00:00.000Z',
    profiles: [{ id: profileId, name: 'Alice', sensitivity: 'normal' }],
    entries
  }
}

describe('ProfileRepository', () => {
  it('reads a valid canonical profile', async () => {
    const stored = database()
    const repository = createProfileRepository(new MemoryStorage({ [PROFILE_STORAGE_KEY]: stored }))

    await expect(repository.get()).resolves.toEqual(stored)
  })

  it('writes and reads validated profile data', async () => {
    const storage = new MemoryStorage()
    const repository = createProfileRepository(storage)
    const stored = database()

    await expect(repository.save(stored)).resolves.toEqual(stored)
    await expect(repository.get()).resolves.toEqual(stored)
  })

  it('returns null when profile data is missing', async () => {
    const repository = createProfileRepository(new MemoryStorage())
    await expect(repository.get()).resolves.toBeNull()
  })

  it('rejects malformed writes and ignores malformed stored data', async () => {
    const storage = new MemoryStorage({
      [PROFILE_STORAGE_KEY]: { version: 1, profiles: 'invalid' },
      unrelated: { accountId: 42 }
    })
    const repository = createProfileRepository(storage)

    await expect(repository.get()).resolves.toBeNull()
    await expect(repository.save({ ...database(), entries: [{ invalid: true }] } as never)).rejects.toThrow()
    expect(storage.writes).toBe(0)
  })

  it('propagates canonical write failures without changing stored data', async () => {
    const canonical = database()
    const replacement = database('bob', [entry('bob')])
    const storage = new MemoryStorage({ [PROFILE_STORAGE_KEY]: canonical })
    storage.failWrites = true

    await expect(createProfileRepository(storage).save(replacement)).rejects.toThrow('write failed')
    expect(storage.values.get(PROFILE_STORAGE_KEY)).toEqual(canonical)
  })

  it('routes initialized vault reads and writes through encrypted storage', async () => {
    const storage = new MemoryStorage()
    const repository = createProfileRepository(storage)
    const stored = database()
    const replacement = { ...stored, updatedAt: '2026-07-12T11:00:00.000Z' }

    await repository.vault.initialize('synthetic vault password', stored)
    await expect(repository.get()).resolves.toEqual(stored)
    await expect(repository.save(replacement)).resolves.toEqual(replacement)
    expect(JSON.stringify([...storage.values.values()])).not.toContain('alice@example.com')

    await repository.vault.lock()
    await expect(repository.get()).rejects.toMatchObject({ code: 'LOCKED' })
    await expect(repository.save(stored)).rejects.toMatchObject({ code: 'LOCKED' })
  })
})
