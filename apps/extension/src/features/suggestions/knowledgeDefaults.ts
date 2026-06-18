import type { ActiveProfile } from './suggestionTypes'
import type { KnowledgeEntry } from './knowledgeTypes'

export const DEFAULT_PROFILE_ID = 'profile_demo'

export const DEFAULT_PROFILE: ActiveProfile = {
  id: DEFAULT_PROFILE_ID,
  name: 'Demo Profile',
  sensitivity: 'normal'
}

export const DEFAULT_ENTRIES: KnowledgeEntry[] = [
  {
    id: 'entry_personal_full_name',
    profileId: DEFAULT_PROFILE_ID,
    label: 'full name',
    value: 'Benedikt Peterson',
    summary: 'Primary full legal name',
    tags: ['name', 'identity'],
    sourceId: 'source_profile_manual',
    sourceLabel: 'Manual profile entry',
    sensitivity: 'normal'
  },
  {
    id: 'entry_personal_email',
    profileId: DEFAULT_PROFILE_ID,
    label: 'email address',
    value: 'benedikt@example.com',
    summary: 'Primary contact email',
    tags: ['email', 'contact'],
    sourceId: 'source_profile_manual',
    sourceLabel: 'Manual profile entry',
    sensitivity: 'normal'
  },
  {
    id: 'entry_personal_phone',
    profileId: DEFAULT_PROFILE_ID,
    label: 'phone number',
    value: '+49 555 123456',
    summary: 'Primary phone number',
    tags: ['phone', 'contact'],
    sourceId: 'source_profile_manual',
    sourceLabel: 'Manual profile entry',
    sensitivity: 'normal'
  },
  {
    id: 'entry_secret_ssn',
    profileId: DEFAULT_PROFILE_ID,
    label: 'social security number',
    value: '000-00-0000',
    summary: 'Secret identifier',
    tags: ['ssn', 'secret'],
    sourceId: 'source_profile_sensitive',
    sourceLabel: 'Sensitive profile entry',
    sensitivity: 'secret'
  }
]
