import type { ActiveProfile, SuggestionSensitivity } from './suggestionTypes'
import type { KnowledgeEntry, StoredKnowledgeBase } from './knowledgeTypes'
import { DEFAULT_ENTRIES, DEFAULT_PROFILE } from './knowledgeDefaults'

export const KNOWLEDGE_BASE_STORAGE_KEY = 'saff.knowledgeBase.v1'

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

export function createChromeStorageAdapter(): StorageAdapter | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null
  }

  return {
    async get<T>(key: string) {
      return await new Promise<T | null>((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve((result?.[key] as T | undefined) ?? null)
        })
      })
    },
    async set<T>(key: string, value: T) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve())
      })
    },
    async remove(key: string) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], () => resolve())
      })
    }
  }
}

function isStoredKnowledgeBase(value: unknown): value is StoredKnowledgeBase {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as StoredKnowledgeBase
  return (
    candidate.version === 1 &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.profiles) &&
    Array.isArray(candidate.entries)
  )
}

export async function loadStoredKnowledgeBase(
  adapter: StorageAdapter | null
): Promise<StoredKnowledgeBase | null> {
  if (!adapter) {
    return null
  }

  const data = await adapter.get<StoredKnowledgeBase>(KNOWLEDGE_BASE_STORAGE_KEY)
  return isStoredKnowledgeBase(data) ? data : null
}

export async function saveStoredKnowledgeBase(
  adapter: StorageAdapter | null,
  data: StoredKnowledgeBase
): Promise<void> {
  if (!adapter) {
    return
  }

  await adapter.set(KNOWLEDGE_BASE_STORAGE_KEY, data)
}

export async function clearStoredKnowledgeBase(adapter: StorageAdapter | null): Promise<void> {
  if (!adapter) {
    return
  }

  await adapter.remove(KNOWLEDGE_BASE_STORAGE_KEY)
}

export function createDemoKnowledgeBase(): StoredKnowledgeBase {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    profiles: [DEFAULT_PROFILE],
    entries: [...DEFAULT_ENTRIES]
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function createEntryId(label: string): string {
  const base = slugify(label) || 'entry'
  const stamp = Date.now().toString(36)
  return `entry_${base}_${stamp}`
}

export async function appendKnowledgeEntry(params: {
  adapter: StorageAdapter | null
  profile: ActiveProfile
  entry: {
    label: string
    value?: string
    summary?: string
    tags?: string[]
    aliases?: string[]
    sensitivity: SuggestionSensitivity
    sourceId?: string
    sourceLabel?: string
  }
}): Promise<StoredKnowledgeBase | null> {
  if (!params.adapter) {
    return null
  }

  const existing = (await loadStoredKnowledgeBase(params.adapter)) ?? createDemoKnowledgeBase()
  const profiles = existing.profiles.some((profile) => profile.id === params.profile.id)
    ? existing.profiles
    : [...existing.profiles, params.profile]

  const newEntry: KnowledgeEntry = {
    id: createEntryId(params.entry.label),
    profileId: params.profile.id,
    label: params.entry.label,
    value: params.entry.value,
    summary: params.entry.summary,
    tags: params.entry.tags,
    aliases: params.entry.aliases,
    sourceId: params.entry.sourceId ?? 'source_demo_manual',
    sourceLabel: params.entry.sourceLabel ?? 'Demo entry',
    sensitivity: params.entry.sensitivity
  }

  const updated: StoredKnowledgeBase = {
    version: 1,
    updatedAt: new Date().toISOString(),
    profiles,
    entries: [...existing.entries, newEntry]
  }

  await saveStoredKnowledgeBase(params.adapter, updated)
  return updated
}
