import { z } from 'zod'
import type { ProfileRepository } from '../suggestions/profileRepository'
import {
  KnowledgeEntrySchema,
  ProfileMetadataSchema,
  StoredProfileDataSchema,
  type KnowledgeEntry,
  type ProfileMetadata,
  type StoredKnowledgeBase
} from '../suggestions/knowledgeTypes'

const ProfileNameSchema = z.string().trim().min(1, 'Profile name is required.').max(200)

function identifier(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
}

function now(): string {
  return new Date().toISOString()
}

function emptyKnowledgeBase(): StoredKnowledgeBase {
  return { version: 1, updatedAt: now(), profiles: [], entries: [] }
}

export class ProfileManagementService {
  constructor(private readonly repository: ProfileRepository) {}

  async list(): Promise<StoredKnowledgeBase> {
    return (await this.repository.get()) ?? emptyKnowledgeBase()
  }

  async create(name: string): Promise<ProfileMetadata> {
    const current = await this.list()
    const timestamp = now()
    const profile = ProfileMetadataSchema.parse({
      id: identifier('profile'),
      name: ProfileNameSchema.parse(name),
      sensitivity: 'normal',
      createdAt: timestamp,
      updatedAt: timestamp
    })
    await this.repository.save(StoredProfileDataSchema.parse({
      ...current,
      updatedAt: timestamp,
      profiles: [...current.profiles, profile]
    }))
    return profile
  }

  async rename(profileId: string, name: string): Promise<void> {
    const current = await this.requireProfile(profileId)
    const timestamp = now()
    await this.repository.save({
      ...current,
      updatedAt: timestamp,
      profiles: current.profiles.map((profile) => profile.id === profileId
        ? { ...profile, name: ProfileNameSchema.parse(name), updatedAt: timestamp }
        : profile)
    })
  }

  async duplicate(profileId: string, name?: string): Promise<ProfileMetadata> {
    const current = await this.requireProfile(profileId)
    const source = current.profiles.find((profile) => profile.id === profileId)!
    const timestamp = now()
    const profile = ProfileMetadataSchema.parse({
      ...source,
      id: identifier('profile'),
      name: ProfileNameSchema.parse(name ?? `${source.name} copy`),
      createdAt: timestamp,
      updatedAt: timestamp
    })
    const entries = current.entries
      .filter((entry) => entry.profileId === profileId)
      .map((entry) => KnowledgeEntrySchema.parse({
        ...entry,
        id: identifier('entry'),
        profileId: profile.id,
        sourceId: 'source_profile_duplicate',
        sourceLabel: `Duplicated from ${source.name}`
      }))
    await this.repository.save({
      ...current,
      updatedAt: timestamp,
      profiles: [...current.profiles, profile],
      entries: [...current.entries, ...entries]
    })
    return profile
  }

  async saveEntry(profileId: string, input: Omit<KnowledgeEntry, 'id' | 'profileId'>, entryId?: string): Promise<KnowledgeEntry> {
    const current = await this.requireProfile(profileId)
    const entry = KnowledgeEntrySchema.parse({ ...input, id: entryId ?? identifier('entry'), profileId })
    const entries = entryId
      ? current.entries.map((item) => item.id === entryId && item.profileId === profileId ? entry : item)
      : [...current.entries, entry]
    if (entryId && !current.entries.some((item) => item.id === entryId && item.profileId === profileId)) {
      throw new Error('Profile entry was not found.')
    }
    const timestamp = now()
    await this.repository.save({
      ...current,
      updatedAt: timestamp,
      profiles: current.profiles.map((profile) => profile.id === profileId
        ? { ...profile, updatedAt: timestamp }
        : profile),
      entries
    })
    return entry
  }

  async deleteEntry(profileId: string, entryId: string): Promise<void> {
    const current = await this.requireProfile(profileId)
    if (!current.entries.some((entry) => entry.id === entryId && entry.profileId === profileId)) {
      throw new Error('Profile entry was not found.')
    }
    await this.repository.save({
      ...current,
      updatedAt: now(),
      entries: current.entries.filter((entry) => entry.id !== entryId || entry.profileId !== profileId)
    })
  }

  async deleteProfile(profileId: string): Promise<void> {
    const current = await this.requireProfile(profileId)
    await this.repository.save({
      ...current,
      updatedAt: now(),
      profiles: current.profiles.filter((profile) => profile.id !== profileId),
      entries: current.entries.filter((entry) => entry.profileId !== profileId)
    })
  }

  private async requireProfile(profileId: string): Promise<StoredKnowledgeBase> {
    const current = await this.list()
    if (!current.profiles.some((profile) => profile.id === profileId)) {
      throw new Error('Profile was not found.')
    }
    return current
  }
}
