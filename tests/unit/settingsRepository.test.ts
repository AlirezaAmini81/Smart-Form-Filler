import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../apps/extension/src/features/suggestions/profileRepository'
import { createSettingsRepository } from '../../apps/extension/src/features/settings/settingsRepository'
import { SETTINGS_STORAGE_KEY } from '../../apps/extension/src/features/settings/settingsTypes'

class MemoryStorage implements StorageAdapter {
  values = new Map<string, unknown>()
  writes = 0
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: unknown) { this.writes += 1; this.values.set(key, value) }
  async remove(key: string) { this.values.delete(key) }
}

describe('SettingsRepository', () => {
  it('provides validated defaults without creating a duplicate storage path', async () => {
    const storage = new MemoryStorage()
    const repository = createSettingsRepository(storage)
    expect(await repository.get()).toMatchObject({ activeProfileId: null, setup: { completed: false, step: 0 } })
    expect(storage.writes).toBe(0)
  })

  it('persists setup progress, active profile, provider, and general preferences together', async () => {
    const storage = new MemoryStorage()
    const repository = createSettingsRepository(storage)
    await repository.update((current) => ({
      ...current,
      activeProfileId: 'profile_work',
      setup: { completed: true, step: 6 },
      provider: { ...current.provider, selectedProvider: 'openai' },
      general: { suggestionMode: 'deterministic-only', confidenceThreshold: 2 }
    }))
    expect(storage.values.size).toBe(1)
    expect(storage.values.get(SETTINGS_STORAGE_KEY)).toMatchObject({
      activeProfileId: 'profile_work',
      setup: { completed: true, step: 6 },
      provider: { selectedProvider: 'openai' }
    })
  })

  it('ignores malformed external storage data', async () => {
    const storage = new MemoryStorage()
    storage.values.set(SETTINGS_STORAGE_KEY, { version: 1, setup: 'invalid' })
    await expect(createSettingsRepository(storage).get()).resolves.toMatchObject({ setup: { step: 0 } })
  })
})
