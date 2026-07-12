import { SettingsSectionSchema, type SettingsSection } from './settingsTypes'

export function settingsPageUrl(section: SettingsSection = 'overview'): string {
  const validated = SettingsSectionSchema.parse(section)
  const path = `settings.html#${validated}`
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : path
}

export async function openSettingsPage(section: SettingsSection = 'overview'): Promise<void> {
  const url = settingsPageUrl(section)
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    await chrome.tabs.create({ url })
    return
  }
  window.location.assign(url)
}
