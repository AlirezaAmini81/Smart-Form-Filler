import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../apps/extension/src/features/suggestions/profileRepository'
import { createProfileRepository } from '../../apps/extension/src/features/suggestions/profileRepository'
import { ProfileManagementService } from '../../apps/extension/src/features/settings/profileManagementService'

class MemoryStorage implements StorageAdapter {
  values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: unknown) { this.values.set(key, value) }
  async remove(key: string) { this.values.delete(key) }
}

describe('ProfileManagementService', () => {
  it('creates, renames, duplicates, and deletes independent profiles', async () => {
    const service = new ProfileManagementService(createProfileRepository(new MemoryStorage()))
    const personal = await service.create('Personal')
    await service.saveEntry(personal.id, {
      label: 'E-mail', value: 'synthetic@example.test', sensitivity: 'sensitive',
      sourceId: 'source_manual', sourceLabel: 'Manual entry'
    })
    await service.rename(personal.id, 'Personal applications')
    const copy = await service.duplicate(personal.id, 'Housing')
    let stored = await service.list()
    expect(stored.profiles.map((profile) => profile.name)).toEqual(['Personal applications', 'Housing'])
    expect(stored.entries.filter((entry) => entry.profileId === copy.id)).toHaveLength(1)

    await service.deleteProfile(personal.id)
    stored = await service.list()
    expect(stored.profiles).toEqual([expect.objectContaining({ id: copy.id })])
    expect(stored.entries.every((entry) => entry.profileId === copy.id)).toBe(true)
  })

  it('edits with a stable entry ID and removes the entry from canonical mapping data', async () => {
    const service = new ProfileManagementService(createProfileRepository(new MemoryStorage()))
    const profile = await service.create('Work')
    const created = await service.saveEntry(profile.id, {
      label: 'Phone', value: '000', sensitivity: 'sensitive', sourceId: 'source_manual'
    })
    const edited = await service.saveEntry(profile.id, {
      label: 'Phone number', value: '111', sensitivity: 'sensitive', sourceId: 'source_manual'
    }, created.id)
    expect(edited.id).toBe(created.id)
    expect((await service.list()).entries).toContainEqual(expect.objectContaining({ id: created.id, value: '111' }))
    await service.deleteEntry(profile.id, created.id)
    expect((await service.list()).entries).toHaveLength(0)
  })

  it('rejects malformed profile and entry changes without modifying data', async () => {
    const service = new ProfileManagementService(createProfileRepository(new MemoryStorage()))
    const profile = await service.create('Valid')
    const before = await service.list()
    await expect(service.rename(profile.id, '')).rejects.toThrow()
    await expect(service.saveEntry(profile.id, { label: '', value: 'x', sensitivity: 'normal', sourceId: 'test' })).rejects.toThrow()
    expect(await service.list()).toEqual(before)
  })
})
