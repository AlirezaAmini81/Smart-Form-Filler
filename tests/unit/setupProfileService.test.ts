import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../apps/extension/src/features/suggestions/profileRepository'
import {
  createProfileRepository,
  PROFILE_STORAGE_KEY
} from '../../apps/extension/src/features/suggestions/profileRepository'
import type { StoredKnowledgeBase } from '../../apps/extension/src/features/suggestions/knowledgeTypes'
import { createStorageKnowledgeRetriever } from '../../apps/extension/src/features/suggestions/knowledgeRetriever'
import { saveReviewedProfile } from '../../apps/extension/src/setup/setupProfileService'

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, unknown>()
  writes = 0

  constructor(initial: unknown) {
    this.values.set(PROFILE_STORAGE_KEY, initial)
  }

  async get(key: string): Promise<unknown> {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: unknown): Promise<void> {
    this.writes += 1
    this.values.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }
}

const existing: StoredKnowledgeBase = {
  version: 1,
  updatedAt: '2026-07-12T10:00:00.000Z',
  profiles: [{ id: 'alice', name: 'Alice', sensitivity: 'normal' }],
  entries: [
    {
      id: 'entry_existing_email',
      profileId: 'alice',
      label: 'E-mail address',
      value: 'old@example.com',
      sourceId: 'source_manual',
      sensitivity: 'sensitive'
    },
    {
      id: 'entry_existing_preference',
      profileId: 'alice',
      label: 'Preferred work location',
      value: 'Remote',
      sourceId: 'source_manual',
      sensitivity: 'normal'
    }
  ]
}

function reviewedInput() {
  return {
    confirmed: true as const,
    profileId: 'alice',
    profileName: 'Alice Example',
    values: { name: 'Alice Example', 'e-mail': 'new@example.com' },
    entries: [{ title: 'Skills', content: 'TypeScript', long: false, sensitivity: 'normal' as const }],
    fieldSensitivity: { 'e-mail': 'sensitive' as const },
    sourceId: 'source_pdf_document_import',
    sourceLabel: 'Imported from synthetic-cv.pdf'
  }
}

describe('saveReviewedProfile', () => {
  it('requires explicit user confirmation before persistence', async () => {
    const storage = new MemoryStorage(existing)
    const repository = createProfileRepository(storage)

    await expect(saveReviewedProfile(repository, { ...reviewedInput(), confirmed: false } as never)).rejects.toThrow()
    expect(storage.writes).toBe(0)
    expect(storage.values.get(PROFILE_STORAGE_KEY)).toEqual(existing)
  })

  it('validates and writes imported data through the canonical repository', async () => {
    const storage = new MemoryStorage(existing)
    const repository = createProfileRepository(storage)

    await saveReviewedProfile(repository, reviewedInput())

    const stored = await repository.get()
    expect(storage.writes).toBe(1)
    expect(stored?.profiles).toContainEqual({ id: 'alice', name: 'Alice Example', sensitivity: 'normal' })
    expect(stored?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'E-mail address', value: 'new@example.com', sourceId: 'source_pdf_document_import' }),
      expect.objectContaining({ label: 'Skills', value: 'TypeScript', sourceLabel: 'Imported from synthetic-cv.pdf' }),
      expect.objectContaining({ label: 'Preferred work location', value: 'Remote' })
    ]))
    expect(stored?.entries.filter((entry) => entry.label === 'E-mail address')).toHaveLength(1)

    const snippets = await createStorageKnowledgeRetriever({ repository }).getRelevantSnippets({
      profileId: 'alice',
      fields: [{ id: 'skills', label: 'Skills', kind: 'input' }],
      maxSnippets: 5
    })
    expect(snippets).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Skills', value: 'TypeScript' })
    ]))
  })

  it('rejects invalid reviewed data and leaves the existing profile unchanged', async () => {
    const storage = new MemoryStorage(existing)
    const repository = createProfileRepository(storage)
    const invalid = { ...reviewedInput(), values: { unknown: 'not supported' } }

    await expect(saveReviewedProfile(repository, invalid as never)).rejects.toThrow()
    expect(storage.writes).toBe(0)
    expect(await repository.get()).toEqual(existing)
  })
})
