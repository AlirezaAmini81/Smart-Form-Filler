import type { StorageAdapter } from '../suggestions/profileRepository'
import {
  createDefaultExtensionSettings,
  ExtensionSettingsSchema,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings
} from './settingsTypes'

export interface SettingsRepository {
  get(): Promise<ExtensionSettings>
  save(settings: ExtensionSettings): Promise<ExtensionSettings>
  update(update: (current: ExtensionSettings) => ExtensionSettings): Promise<ExtensionSettings>
}

export function createSettingsRepository(adapter: StorageAdapter): SettingsRepository {
  const get = async (): Promise<ExtensionSettings> => {
    const parsed = ExtensionSettingsSchema.safeParse(await adapter.get(SETTINGS_STORAGE_KEY))
    return parsed.success ? parsed.data : createDefaultExtensionSettings()
  }

  const save = async (settings: ExtensionSettings): Promise<ExtensionSettings> => {
    const validated = ExtensionSettingsSchema.parse(settings)
    await adapter.set(SETTINGS_STORAGE_KEY, validated)
    const confirmed = ExtensionSettingsSchema.safeParse(await adapter.get(SETTINGS_STORAGE_KEY))
    if (!confirmed.success) throw new Error('Extension settings write could not be verified.')
    return confirmed.data
  }

  return {
    get,
    save,
    async update(update) {
      return await save(update(await get()))
    }
  }
}

export function createChromeSettingsRepository(): SettingsRepository | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
  const adapter: StorageAdapter = {
    async get(key) {
      return await new Promise((resolve, reject) => {
        chrome.storage.local.get([key], (result) => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve(result[key] ?? null)
        })
      })
    },
    async set(key, value) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve()
        })
      })
    },
    async remove(key) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.remove([key], () => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve()
        })
      })
    }
  }
  return createSettingsRepository(adapter)
}
