import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../apps/extension/src/features/suggestions/profileRepository'
import { createProfileRepository } from '../../apps/extension/src/features/suggestions/profileRepository'
import type { StoredKnowledgeBase } from '../../apps/extension/src/features/suggestions/knowledgeTypes'
import { confirmDocumentImport } from '../../apps/extension/src/features/settings/documentImportService'

class MemoryStorage implements StorageAdapter {
  values = new Map<string, unknown>(); writes = 0
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: unknown) { this.writes += 1; this.values.set(key, value) }
  async remove(key: string) { this.values.delete(key) }
}

const existing: StoredKnowledgeBase = {
  version: 1,
  updatedAt: '2026-07-12T10:00:00.000Z',
  profiles: [{ id: 'target', name: 'Target', sensitivity: 'normal' }],
  entries: [{ id: 'email', profileId: 'target', label: 'E-mail address', value: 'old@example.test', sensitivity: 'sensitive', sourceId: 'source_manual' }]
}

describe('confirmed document import', () => {
  it('does not persist unconfirmed candidates', async () => {
    const storage = new MemoryStorage()
    const repository = createProfileRepository(storage)
    await repository.save(existing)
    const writes = storage.writes
    await expect(confirmDocumentImport(repository, {
      confirmed: false,
      profileId: 'target', sourceId: 'source_pdf_test', sourceLabel: 'Synthetic PDF', candidates: []
    } as never)).rejects.toThrow()
    expect(storage.writes).toBe(writes)
  })

  it('applies explicit keep, replace, and alternative conflict decisions atomically', async () => {
    const storage = new MemoryStorage()
    const repository = createProfileRepository(storage)
    await repository.save(existing)
    await confirmDocumentImport(repository, {
      confirmed: true,
      profileId: 'target', sourceId: 'source_pdf_test', sourceLabel: 'Synthetic PDF',
      candidates: [
        { id: 'keep', label: 'E-mail address', value: 'ignored@example.test', sensitivity: 'sensitive', decision: 'keep' },
        { id: 'replace', label: 'Phone', value: '123', sensitivity: 'sensitive', decision: 'replace' },
        { id: 'alternative', label: 'Phone', value: '456', sensitivity: 'sensitive', decision: 'alternative' }
      ]
    })
    const stored = await repository.get()
    expect(stored?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'old@example.test' }),
      expect.objectContaining({ label: 'Phone', value: '123' }),
      expect.objectContaining({ label: 'Phone', value: '456' })
    ]))
    expect(stored?.profiles[0].sourceIds).toContain('source_pdf_test')
  })
})
