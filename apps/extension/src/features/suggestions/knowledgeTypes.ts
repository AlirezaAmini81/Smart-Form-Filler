import type { ActiveProfile, SuggestionSensitivity } from './suggestionTypes'

export interface KnowledgeEntry {
  id: string
  profileId: string
  label: string
  value?: string
  summary?: string
  tags?: string[]
  aliases?: string[]
  sourceId: string
  sourceLabel?: string
  sensitivity: SuggestionSensitivity
}

export interface StoredKnowledgeBase {
  version: 1
  updatedAt: string
  profiles: ActiveProfile[]
  entries: KnowledgeEntry[]
}
