import { describe, expect, it } from 'vitest'
import type { SuggestedFieldValue } from '../../packages/shared/src/schemas'
import { createDefaultExtensionSettings } from '../../apps/extension/src/features/settings/settingsTypes'
import {
  approveAllReviewSuggestions,
  canStartAnalysis,
  createReviewSuggestions,
  errorSettingsSection,
  getBlockingState,
  isAnalysisCurrent,
  summarizeSuggestions
} from '../../apps/extension/src/popup/popupState'

function readySettings() {
  const settings = createDefaultExtensionSettings()
  return {
    ...settings,
    activeProfileId: 'profile_alpha',
    setup: { completed: true, step: 6 }
  }
}

function suggestion(overrides: Partial<SuggestedFieldValue> = {}): SuggestedFieldValue {
  return {
    fieldId: 'field_email',
    fieldLocator: 'locator_email',
    fieldName: 'email',
    fieldLabel: 'Email',
    suggestedValue: 'person@example.test',
    valueType: 'direct-copy',
    confidence: 'high',
    reasoningSummary: 'Synthetic exact match.',
    provenance: {
      profileId: 'profile_alpha',
      knowledgeEntryIds: ['entry_email'],
      sourceIds: ['source_synthetic']
    },
    sensitivity: 'normal',
    requiresUserConfirmation: false,
    warnings: [],
    ...overrides
  }
}

describe('popup operational state', () => {
  it('routes setup-incomplete state to Setup', () => {
    expect(getBlockingState({ settings: createDefaultExtensionSettings(), vaultStatus: 'uninitialized', activeProfileExists: false, providerAvailable: false }))
      .toEqual({ kind: 'setup', section: 'setup' })
  })

  it('routes locked state to Encryption', () => {
    expect(getBlockingState({ settings: readySettings(), vaultStatus: 'locked', activeProfileExists: false, providerAvailable: false }))
      .toEqual({ kind: 'vault', section: 'encryption' })
  })

  it('routes missing active profile to Profiles', () => {
    expect(getBlockingState({ settings: readySettings(), vaultStatus: 'uninitialized', activeProfileExists: false, providerAvailable: true }))
      .toEqual({ kind: 'profile', section: 'profiles' })
  })

  it('routes an unavailable configured provider to Providers', () => {
    expect(getBlockingState({ settings: readySettings(), vaultStatus: 'uninitialized', activeProfileExists: true, providerAvailable: false }))
      .toEqual({ kind: 'provider', section: 'providers' })
  })

  it('is ready when canonical prerequisites are available', () => {
    expect(getBlockingState({ settings: readySettings(), vaultStatus: 'unlocked', activeProfileExists: true, providerAvailable: true })).toBeNull()
  })

  it('allows deterministic-only mode without a provider connection', () => {
    const settings = readySettings()
    settings.general.suggestionMode = 'deterministic-only'
    expect(getBlockingState({ settings, vaultStatus: 'uninitialized', activeProfileExists: true, providerAvailable: false })).toBeNull()
  })

  it('prevents duplicate analysis while loading or analyzing', () => {
    expect(canStartAnalysis('loading')).toBe(false)
    expect(canStartAnalysis('analyzing')).toBe(false)
    expect(canStartAnalysis('ready')).toBe(true)
  })

  it('starts generated suggestions unapproved', () => {
    expect(createReviewSuggestions([suggestion()])).toMatchObject([{ decision: 'pending', value: 'person@example.test' }])
  })

  it('summarizes fillable, unresolved, and approved results', () => {
    const items = createReviewSuggestions([
      suggestion(),
      suggestion({ fieldId: 'field_phone', confidence: 'low', sensitivity: 'sensitive' }),
      suggestion({ fieldId: 'field_unknown', suggestedValue: null })
    ])
    items[0].decision = 'approved'
    expect(summarizeSuggestions(items)).toEqual({ total: 3, fillable: 2, unresolved: 1, approved: 1 })
  })

  it('enables filling only for an approved non-empty value', () => {
    const items = createReviewSuggestions([suggestion()])
    expect(summarizeSuggestions(items).approved).toBe(0)
    items[0].decision = 'approved'
    expect(summarizeSuggestions(items).approved).toBe(1)
    items[0].value = '   '
    expect(summarizeSuggestions(items).approved).toBe(0)
  })

  it('represents rejection separately from an undecided suggestion', () => {
    const items = createReviewSuggestions([suggestion()])
    expect(items[0].decision).toBe('pending')
    items[0].decision = 'rejected'
    expect(items[0].decision).toBe('rejected')
    expect(summarizeSuggestions(items).approved).toBe(0)
  })

  it('approves every fillable suggestion while leaving unresolved values pending', () => {
    const approved = approveAllReviewSuggestions(createReviewSuggestions([
      suggestion(),
      suggestion({ fieldId: 'field_unknown', suggestedValue: null })
    ]))
    expect(approved.map((item) => item.decision)).toEqual(['approved', 'pending'])
    expect(summarizeSuggestions(approved).approved).toBe(1)
  })

  it('invalidates analysis when the active profile changes', () => {
    expect(isAnalysisCurrent({ analyzedTabId: 7, currentTabId: 7, analyzedUrl: 'https://example.test/form', currentUrl: 'https://example.test/form', analyzedProfileId: 'profile_alpha', currentProfileId: 'profile_beta' })).toBe(false)
  })

  it('invalidates analysis when the tab or URL changes', () => {
    expect(isAnalysisCurrent({ analyzedTabId: 7, currentTabId: 8, analyzedUrl: 'https://example.test/form', currentUrl: 'https://example.test/other', analyzedProfileId: 'profile_alpha', currentProfileId: 'profile_alpha' })).toBe(false)
  })

  it('accepts analysis bound to the same tab, URL, and profile', () => {
    expect(isAnalysisCurrent({ analyzedTabId: 7, currentTabId: 7, analyzedUrl: 'https://example.test/form', currentUrl: 'https://example.test/form', analyzedProfileId: 'profile_alpha', currentProfileId: 'profile_alpha' })).toBe(true)
  })

  it('maps provider and vault failures to relevant settings', () => {
    expect(errorSettingsSection('provider-unavailable')).toBe('providers')
    expect(errorSettingsSection('invalid-response')).toBe('providers')
    expect(errorSettingsSection('vault-unavailable')).toBe('encryption')
  })

  it('keeps content, stale-analysis, and insertion repair local', () => {
    expect(errorSettingsSection('content-unavailable')).toBeNull()
    expect(errorSettingsSection('stale-analysis')).toBeNull()
    expect(errorSettingsSection('fill-failed')).toBeNull()
  })
})
