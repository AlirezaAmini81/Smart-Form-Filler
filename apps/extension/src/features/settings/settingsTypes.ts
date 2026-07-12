import { z } from 'zod'
import { SuggestionModeSchema } from '../../../../../packages/shared/src/schemas'
import { PROVIDER_CATALOG, ProviderIdSchema } from '../../lib/llm/providerCatalog'

export const SETTINGS_STORAGE_KEY = 'saff.settings.v1'

export const SettingsSectionSchema = z.enum([
  'overview',
  'setup',
  'profiles',
  'documents',
  'providers',
  'encryption',
  'general'
])

export const ExtensionSettingsSchema = z.object({
  version: z.literal(1),
  activeProfileId: z.string().trim().min(1).nullable(),
  setup: z.object({
    completed: z.boolean(),
    step: z.number().int().min(0).max(6)
  }).strict(),
  provider: z.object({
    selectedProvider: ProviderIdSchema,
    providers: z.object({
      openai: z.object({ model: z.string().trim().min(1) }).strict(),
      anthropic: z.object({ model: z.string().trim().min(1) }).strict(),
      mistral: z.object({ model: z.string().trim().min(1) }).strict(),
      ollama: z.object({ endpoint: z.string().url(), model: z.string().trim().min(1) }).strict()
    }).strict()
  }).strict(),
  general: z.object({
    suggestionMode: SuggestionModeSchema,
    confidenceThreshold: z.number().int().min(0).max(2)
  }).strict()
}).strict()

export type ExtensionSettings = z.infer<typeof ExtensionSettingsSchema>
export type SettingsSection = z.infer<typeof SettingsSectionSchema>

export function createDefaultExtensionSettings(): ExtensionSettings {
  return {
    version: 1,
    activeProfileId: null,
    setup: { completed: false, step: 0 },
    provider: {
      selectedProvider: 'ollama',
      providers: {
        openai: { model: PROVIDER_CATALOG.openai.defaultModel },
        anthropic: { model: PROVIDER_CATALOG.anthropic.defaultModel },
        mistral: { model: PROVIDER_CATALOG.mistral.defaultModel },
        ollama: { endpoint: 'http://localhost:11434', model: PROVIDER_CATALOG.ollama.defaultModel }
      }
    },
    general: {
      suggestionMode: 'identifier-only',
      confidenceThreshold: 0
    }
  }
}
