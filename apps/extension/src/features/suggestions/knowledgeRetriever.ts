import type { ActiveProfile, RetrievedKnowledgeSnippet, SuggestionField } from './suggestionTypes'
import type { KnowledgeEntry } from './knowledgeTypes'
import type { StorageAdapter } from './knowledgeStore'
import { DEFAULT_ENTRIES, DEFAULT_PROFILE, DEFAULT_PROFILE_ID } from './knowledgeDefaults'
import { createChromeStorageAdapter, loadStoredKnowledgeBase } from './knowledgeStore'

export interface KnowledgeRetrievalInput {
  profileId: string
  fields: SuggestionField[]
  maxSnippets: number
}

export interface KnowledgeRetriever {
  getProfile(profileId: string): Promise<ActiveProfile | null>
  getRelevantSnippets(input: KnowledgeRetrievalInput): Promise<RetrievedKnowledgeSnippet[]>
}

export { DEFAULT_PROFILE, DEFAULT_PROFILE_ID }

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

export function scoreEntryForField(entry: KnowledgeEntry, field: SuggestionField): number {
  const fieldTokens = new Set(
    normalizeTokens([
      field.label,
      field.name,
      field.placeholder,
      field.ariaLabel,
      field.type
    ]
      .filter(Boolean)
      .join(' '))
  )

  const entryTokens = new Set(
    normalizeTokens([
      entry.label,
      entry.value,
      entry.summary,
      ...(entry.tags ?? []),
      ...(entry.aliases ?? [])
    ]
      .filter(Boolean)
      .join(' '))
  )

  let score = 0
  fieldTokens.forEach((token) => {
    if (entryTokens.has(token)) {
      score += 1
    }
  })

  return score
}

export function scoreEntryForFields(entry: KnowledgeEntry, fields: SuggestionField[]): number {
  if (fields.length === 0) {
    return 0
  }

  return Math.max(...fields.map((field) => scoreEntryForField(entry, field)))
}

export function createInMemoryKnowledgeRetriever(params?: {
  profiles?: ActiveProfile[]
  entries?: KnowledgeEntry[]
}): KnowledgeRetriever {
  const profiles = params?.profiles ?? [DEFAULT_PROFILE]
  const entries = params?.entries ?? DEFAULT_ENTRIES
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))

  return {
    async getProfile(profileId) {
      return profileMap.get(profileId) ?? null
    },
    async getRelevantSnippets({ profileId, fields, maxSnippets }) {
      const candidates = entries.filter((entry) => entry.profileId === profileId)
      const ranked = candidates
        .map((entry) => ({ entry, score: scoreEntryForFields(entry, fields) }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSnippets)

      return ranked.map(({ entry, score }) => ({
        id: entry.id,
        profileId: entry.profileId,
        label: entry.label,
        value: entry.value,
        summary: entry.summary,
        tags: entry.tags,
        sourceId: entry.sourceId,
        sourceLabel: entry.sourceLabel,
        sensitivity: entry.sensitivity,
        score
      }))
    }
  }
}

export function createStorageKnowledgeRetriever(params: {
  adapter: StorageAdapter
  fallbackProfiles?: ActiveProfile[]
  fallbackEntries?: KnowledgeEntry[]
}): KnowledgeRetriever {
  const fallbackProfiles = params.fallbackProfiles ?? [DEFAULT_PROFILE]
  const fallbackEntries = params.fallbackEntries ?? DEFAULT_ENTRIES

  const resolveProfiles = async () => {
    const stored = await loadStoredKnowledgeBase(params.adapter)
    return stored?.profiles?.length ? stored.profiles : fallbackProfiles
  }

  const resolveEntries = async () => {
    const stored = await loadStoredKnowledgeBase(params.adapter)
    return stored?.entries?.length ? stored.entries : fallbackEntries
  }

  return {
    async getProfile(profileId) {
      const profiles = await resolveProfiles()
      return profiles.find((profile) => profile.id === profileId) ?? null
    },
    async getRelevantSnippets({ profileId, fields, maxSnippets }) {
      const entries = await resolveEntries()
      const candidates = entries.filter((entry) => entry.profileId === profileId)
      const ranked = candidates
        .map((entry) => ({ entry, score: scoreEntryForFields(entry, fields) }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSnippets)

      return ranked.map(({ entry, score }) => ({
        id: entry.id,
        profileId: entry.profileId,
        label: entry.label,
        value: entry.value,
        summary: entry.summary,
        tags: entry.tags,
        sourceId: entry.sourceId,
        sourceLabel: entry.sourceLabel,
        sensitivity: entry.sensitivity,
        score
      }))
    }
  }
}

export function createDefaultKnowledgeRetriever(): KnowledgeRetriever {
  const adapter = createChromeStorageAdapter()
  if (adapter) {
    // TODO: Replace with the real knowledge base module after merge.
    return createStorageKnowledgeRetriever({ adapter })
  }

  return createInMemoryKnowledgeRetriever()
}
