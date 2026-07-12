import { SettingsSectionSchema, type SettingsSection } from './settingsTypes'

export const SETTINGS_SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'setup', label: 'Setup' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'documents', label: 'Documents' },
  { id: 'providers', label: 'Providers' },
  { id: 'encryption', label: 'Encryption' },
  { id: 'general', label: 'General settings' }
]

export function sectionFromHash(hash: string): SettingsSection {
  const parsed = SettingsSectionSchema.safeParse(hash.replace(/^#/, ''))
  return parsed.success ? parsed.data : 'overview'
}

export function adjacentSection(current: SettingsSection, direction: 1 | -1): SettingsSection {
  const index = SETTINGS_SECTIONS.findIndex((section) => section.id === current)
  const next = (index + direction + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
  return SETTINGS_SECTIONS[next].id
}
