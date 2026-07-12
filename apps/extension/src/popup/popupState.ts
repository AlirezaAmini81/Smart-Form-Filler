import type { SuggestedFieldValue } from '../../../../packages/shared/src/schemas'
import type { VaultStatus } from '../features/suggestions/profileVault'
import type { ExtensionSettings, SettingsSection } from '../features/settings/settingsTypes'

export type PopupErrorKind =
  | 'content-unavailable'
  | 'provider-unavailable'
  | 'vault-unavailable'
  | 'invalid-response'
  | 'stale-analysis'
  | 'fill-failed'

export type PopupPhase =
  | 'loading'
  | 'ready'
  | 'analyzing'
  | 'no-fields'
  | 'suggestions'
  | 'review'
  | 'filling'
  | 'completed'
  | 'error'

export type ReviewSuggestion = {
  suggestion: SuggestedFieldValue
  decision: 'pending' | 'approved' | 'rejected'
  value: string
}

export type SuggestionSummary = {
  total: number
  fillable: number
  unresolved: number
  approved: number
}

export type BlockingState =
  | { kind: 'setup'; section: SettingsSection }
  | { kind: 'vault'; section: SettingsSection }
  | { kind: 'profile'; section: SettingsSection }
  | { kind: 'provider'; section: SettingsSection }
  | null

export function getBlockingState(params: {
  settings: ExtensionSettings
  vaultStatus: VaultStatus
  activeProfileExists: boolean
  providerAvailable: boolean | null
}): BlockingState {
  if (!params.settings.setup.completed) return { kind: 'setup', section: 'setup' }
  if (['locked', 'corrupted', 'migration-failed'].includes(params.vaultStatus)) {
    return { kind: 'vault', section: 'encryption' }
  }
  if (!params.settings.activeProfileId || !params.activeProfileExists) {
    return { kind: 'profile', section: 'profiles' }
  }
  if (params.settings.general.suggestionMode !== 'deterministic-only' && params.providerAvailable === false) {
    return { kind: 'provider', section: 'providers' }
  }
  return null
}

export function createReviewSuggestions(suggestions: SuggestedFieldValue[]): ReviewSuggestion[] {
  return suggestions.map((suggestion) => ({
    suggestion,
    decision: 'pending',
    value: suggestion.suggestedValue ?? ''
  }))
}

export function approveAllReviewSuggestions(items: ReviewSuggestion[]): ReviewSuggestion[] {
  return items.map((item) => item.suggestion.suggestedValue === null || !item.value.trim()
    ? item
    : { ...item, decision: 'approved' })
}

export function summarizeSuggestions(items: ReviewSuggestion[]): SuggestionSummary {
  return items.reduce<SuggestionSummary>((summary, item) => {
    summary.total += 1
    if (item.suggestion.suggestedValue === null || !item.value.trim()) {
      summary.unresolved += 1
    } else {
      summary.fillable += 1
    }
    if (item.decision === 'approved' && item.value.trim()) summary.approved += 1
    return summary
  }, { total: 0, fillable: 0, unresolved: 0, approved: 0 })
}

export function canStartAnalysis(phase: PopupPhase): boolean {
  return !['analyzing', 'filling', 'loading'].includes(phase)
}

export function isAnalysisCurrent(params: {
  analyzedTabId: number
  analyzedUrl?: string
  analyzedProfileId: string
  currentTabId: number
  currentUrl?: string
  currentProfileId: string | null
}): boolean {
  return params.analyzedTabId === params.currentTabId
    && params.analyzedUrl === params.currentUrl
    && params.analyzedProfileId === params.currentProfileId
}

export function errorSettingsSection(kind: PopupErrorKind): SettingsSection | null {
  if (kind === 'provider-unavailable' || kind === 'invalid-response') return 'providers'
  if (kind === 'vault-unavailable') return 'encryption'
  return null
}
