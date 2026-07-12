import type { ActiveProfile } from './suggestionTypes'
import {
  StoredProfileDataSchema,
  type KnowledgeEntry,
  type StoredKnowledgeBase
} from './knowledgeTypes'
import { DEFAULT_ENTRIES, DEFAULT_PROFILE } from './knowledgeDefaults'
import { createProfileVault, type ProfileVault } from './profileVault'

export const PROFILE_STORAGE_KEY = 'saff.profiles.v1'

export interface StorageAdapter {
  get(key: string): Promise<unknown>
  getAll?(): Promise<Record<string, unknown>>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  removeMany?(keys: string[]): Promise<void>
}

export interface ProfileRepository {
  readonly vault: ProfileVault
  get(): Promise<StoredKnowledgeBase | null>
  save(data: StoredKnowledgeBase): Promise<StoredKnowledgeBase>
  clear(): Promise<void>
  appendEntry(params: {
    profile: ActiveProfile
    entry: Omit<KnowledgeEntry, 'id' | 'profileId' | 'sourceId'> & { sourceId?: string }
  }): Promise<StoredKnowledgeBase>
  upsertProfile(profile: ActiveProfile, entries: KnowledgeEntry[]): Promise<StoredKnowledgeBase>
}

function chromeError(): Error | null {
  const message = chrome.runtime?.lastError?.message
  return message ? new Error(message) : null
}

export function createChromeStorageAdapter(): StorageAdapter | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null
  }

  return {
    async get(key) {
      return await new Promise<unknown>((resolve, reject) => {
        chrome.storage.local.get([key], (result) => {
          const error = chromeError()
          if (error) reject(error)
          else resolve(result?.[key] ?? null)
        })
      })
    },
    async getAll() {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        chrome.storage.local.get(null, (result) => {
          const error = chromeError()
          if (error) reject(error)
          else resolve(result ?? {})
        })
      })
    },
    async set(key, value) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          const error = chromeError()
          if (error) reject(error)
          else resolve()
        })
      })
    },
    async remove(key) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.remove([key], () => {
          const error = chromeError()
          if (error) reject(error)
          else resolve()
        })
      })
    },
    async removeMany(keys) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
          const error = chromeError()
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}

export function createChromeSessionStorageAdapter(): StorageAdapter | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return null
  return {
    async get(key) {
      return await new Promise<unknown>((resolve, reject) => {
        chrome.storage.session.get([key], (result) => {
          const error = chromeError()
          if (error) reject(error)
          else resolve(result?.[key] ?? null)
        })
      })
    },
    async set(key, value) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.session.set({ [key]: value }, () => {
          const error = chromeError()
          if (error) reject(error)
          else resolve()
        })
      })
    },
    async remove(key) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.session.remove([key], () => {
          const error = chromeError()
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function createEntryId(label: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `entry_${slugify(label) || 'entry'}_${suffix}`
}

function createDemoKnowledgeBase(): StoredKnowledgeBase {
  return StoredProfileDataSchema.parse({
    version: 1,
    updatedAt: new Date().toISOString(),
    profiles: [DEFAULT_PROFILE],
    entries: DEFAULT_ENTRIES
  })
}

export function createProfileRepository(
  adapter: StorageAdapter,
  sessionAdapter?: StorageAdapter
): ProfileRepository {
  const vault = createProfileVault({ persistentStorage: adapter, sessionStorage: sessionAdapter })
  const save = async (data: StoredKnowledgeBase): Promise<StoredKnowledgeBase> => {
    const validated = StoredProfileDataSchema.parse(data)
    const status = await vault.getStatus()
    if (status === 'unlocked') {
      await vault.writeProfile(validated)
      return await vault.readProfile()
    }
    if (status === 'locked' || status === 'corrupted') {
      return await vault.writeProfile(validated).then(async () => await vault.readProfile())
    }
    await adapter.set(PROFILE_STORAGE_KEY, validated)
    const confirmed = StoredProfileDataSchema.safeParse(await adapter.get(PROFILE_STORAGE_KEY))
    if (!confirmed.success) throw new Error('Canonical profile write could not be verified.')
    return confirmed.data
  }

  const get = async (): Promise<StoredKnowledgeBase | null> => {
    const status = await vault.getStatus()
    if (status === 'unlocked') return await vault.readProfile()
    if (status === 'locked' || status === 'corrupted') return await vault.readProfile()
    const canonical = StoredProfileDataSchema.safeParse(await adapter.get(PROFILE_STORAGE_KEY))
    return canonical.success ? canonical.data : null
  }

  return {
    vault,
    get,
    save,
    async clear() {
      await vault.clear()
    },
    async appendEntry({ profile, entry }) {
      const existing = (await get()) ?? createDemoKnowledgeBase()
      const profiles = existing.profiles.some((item) => item.id === profile.id)
        ? existing.profiles
        : [...existing.profiles, profile]
      return await save({
        version: 1,
        updatedAt: new Date().toISOString(),
        profiles,
        entries: [...existing.entries, {
          ...entry,
          id: createEntryId(entry.label),
          profileId: profile.id,
          sourceId: entry.sourceId ?? 'source_demo_manual'
        }]
      })
    },
    async upsertProfile(profile, newEntries) {
      if (newEntries.some((entry) => entry.profileId !== profile.id)) {
        throw new Error('Profile entries must reference the profile being updated.')
      }
      const existing = (await get()) ?? createDemoKnowledgeBase()
      const profiles = existing.profiles.some((item) => item.id === profile.id)
        ? existing.profiles.map((item) => item.id === profile.id ? profile : item)
        : [...existing.profiles, profile]
      const labels = new Set(newEntries.map((entry) => entry.label))
      return await save({
        version: 1,
        updatedAt: new Date().toISOString(),
        profiles,
        entries: [
          ...existing.entries.filter((entry) =>
            entry.profileId !== profile.id || !labels.has(entry.label)
          ),
          ...newEntries
        ]
      })
    }
  }
}

export function createChromeProfileRepository(): ProfileRepository | null {
  const adapter = createChromeStorageAdapter()
  if (!adapter) return null
  try {
    void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    void chrome.storage.session?.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  } catch {
    // Older Chromium versions may not support storage access levels.
  }
  return createProfileRepository(adapter, createChromeSessionStorageAdapter() ?? undefined)
}
