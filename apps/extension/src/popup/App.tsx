import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormFieldMetadata, SuggestedFieldValue } from '../../../../packages/shared/src/schemas'
import { openSettingsPage } from '../features/settings/openSettingsPage'
import { createChromeSettingsRepository } from '../features/settings/settingsRepository'
import { createDefaultExtensionSettings, type ExtensionSettings, type SettingsSection } from '../features/settings/settingsTypes'
import { createChromeProfileRepository } from '../features/suggestions/profileRepository'
import { PROFILE_VAULT_SESSION_KEY, type VaultStatus } from '../features/suggestions/profileVault'
import type { StoredKnowledgeBase } from '../features/suggestions/knowledgeTypes'
import type { PrivacyMode } from '../features/suggestions/suggestionTypes'
import type { ExtractionResult, FormField } from '../lib/dom/extractFormFields'
import type { FieldAnswer, FillResult } from '../lib/dom/fillFormFields'
import type { LlmProviderStatus } from '../lib/llm/types'
import { PROVIDER_CATALOG } from '../lib/llm/providerCatalog'
import type { BackgroundRequest, GenerateFieldSuggestionsResponse, ProviderStatusResponse } from '../lib/messaging/types'
import {
  approveAllReviewSuggestions,
  canStartAnalysis,
  createReviewSuggestions,
  errorSettingsSection,
  getBlockingState,
  isAnalysisCurrent,
  summarizeSuggestions,
  type PopupErrorKind,
  type PopupPhase,
  type ReviewSuggestion
} from './popupState'

type AnalysisSnapshot = {
  tabId: number
  url?: string
  profileId: string
  extraction: ExtractionResult
}

type PopupError = { kind: PopupErrorKind; message: string }

function sendRuntimeMessage<T>(message: BackgroundRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve(response as T)
    })
  })
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve(response as T)
    })
  })
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] ?? null))
  })
}

function toMetadata(field: FormField): FormFieldMetadata {
  return {
    locator: field.locator,
    id: field.id || undefined,
    name: field.name || undefined,
    label: field.label || undefined,
    placeholder: field.placeholder || undefined,
    autocomplete: field.autocomplete || undefined,
    title: field.title || undefined,
    inputMode: field.inputMode || undefined,
    type: field.type || undefined,
    value: field.value || undefined,
    options: field.options.length ? field.options : undefined,
    kind: field.tag === 'textarea' ? 'textarea' : field.tag === 'select' ? 'select' : 'input'
  }
}

function providerName(settings: ExtensionSettings): string {
  if (settings.general.suggestionMode === 'deterministic-only') return 'Direct matching'
  return PROVIDER_CATALOG[settings.provider.selectedProvider].name
}

function privacyMode(settings: ExtensionSettings): PrivacyMode {
  return PROVIDER_CATALOG[settings.provider.selectedProvider].mode === 'cloud' ? 'cloud-opt-in' : 'local-only'
}

function fieldForSuggestion(snapshot: AnalysisSnapshot | null, suggestion: SuggestedFieldValue): FormField | undefined {
  return snapshot?.extraction.fields.find((field) =>
    (suggestion.fieldLocator && field.locator === suggestion.fieldLocator)
    || (suggestion.fieldName && field.name === suggestion.fieldName)
    || field.id === suggestion.fieldId
  )
}

function readableProviderError(message: string): string {
  return message.toLowerCase().includes('invalid')
    ? 'The provider returned an invalid response. Check its configuration and try again.'
    : 'The selected provider could not generate suggestions. Check its connection and try again.'
}

export default function App() {
  const settingsRepository = useMemo(() => createChromeSettingsRepository(), [])
  const profileRepository = useMemo(() => createChromeProfileRepository(), [])
  const [settings, setSettings] = useState<ExtensionSettings>(createDefaultExtensionSettings)
  const [profiles, setProfiles] = useState<StoredKnowledgeBase['profiles']>([])
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>('uninitialized')
  const [providerStatus, setProviderStatus] = useState<LlmProviderStatus | null>(null)
  const [stateLoaded, setStateLoaded] = useState(false)
  const [phase, setPhase] = useState<PopupPhase>('loading')
  const [detectedFields, setDetectedFields] = useState(0)
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewSuggestion[]>([])
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [popupError, setPopupError] = useState<PopupError | null>(null)
  const busyRef = useRef(false)
  const settingsRef = useRef(settings)

  const activeProfile = profiles.find((profile) => profile.id === settings.activeProfileId) ?? null
  const providerAvailable = settings.general.suggestionMode === 'deterministic-only'
    ? true
    : providerStatus?.available ?? null
  const blocking = stateLoaded ? getBlockingState({
    settings,
    vaultStatus,
    activeProfileExists: activeProfile !== null,
    providerAvailable
  }) : null
  const summary = useMemo(() => summarizeSuggestions(reviewItems), [reviewItems])

  const resetAnalysis = useCallback(() => {
    setSnapshot(null)
    setReviewItems([])
    setFillResult(null)
    setPopupError(null)
    setDetectedFields(0)
    setPhase('ready')
  }, [])

  const loadCanonicalState = useCallback(async () => {
    if (!settingsRepository || !profileRepository) {
      setPopupError({ kind: 'vault-unavailable', message: 'Extension storage is unavailable.' })
      setPhase('error')
      setStateLoaded(true)
      return
    }

    try {
      const nextSettings = await settingsRepository.get()
      const nextVaultStatus = await profileRepository.vault.getStatus()
      let nextProfiles: StoredKnowledgeBase['profiles'] = []
      if (!['locked', 'corrupted', 'migration-failed'].includes(nextVaultStatus)) {
        nextProfiles = (await profileRepository.get())?.profiles ?? []
      }

      let nextProviderStatus: LlmProviderStatus | null = null
      if (nextSettings.general.suggestionMode !== 'deterministic-only') {
        try {
          const response = await sendRuntimeMessage<ProviderStatusResponse>({
            type: 'GET_LLM_PROVIDER_STATUS',
            payload: {
              providerId: nextSettings.provider.selectedProvider
            }
          })
          if (response.ok) nextProviderStatus = response.status
        } catch {
          nextProviderStatus = { available: false, label: providerName(nextSettings) }
        }
      }

      const currentSettings = settingsRef.current
      if (currentSettings.activeProfileId !== nextSettings.activeProfileId
        || currentSettings.provider.selectedProvider !== nextSettings.provider.selectedProvider
        || currentSettings.general.suggestionMode !== nextSettings.general.suggestionMode) {
        resetAnalysis()
      }
      settingsRef.current = nextSettings
      setSettings(nextSettings)
      setVaultStatus(nextVaultStatus)
      setProfiles(nextProfiles)
      setProviderStatus(nextProviderStatus)
      setStateLoaded(true)
      setPhase((current) => current === 'loading' ? 'ready' : current)
    } catch {
      setPopupError({ kind: 'vault-unavailable', message: 'Profile and settings state could not be loaded.' })
      setPhase('error')
      setStateLoaded(true)
    }
  }, [profileRepository, resetAnalysis, settingsRepository])

  useEffect(() => { void loadCanonicalState() }, [loadCanonicalState])

  useEffect(() => {
    if (!chrome.storage?.onChanged) return
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' || (areaName === 'session' && PROFILE_VAULT_SESSION_KEY in changes)) {
        void loadCanonicalState()
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [loadCanonicalState])

  const openSection = (section: SettingsSection) => { void openSettingsPage(section) }

  const changeProfile = async (profileId: string) => {
    if (!settingsRepository || profileId === settings.activeProfileId) return
    resetAnalysis()
    const updated = await settingsRepository.update((current) => ({ ...current, activeProfileId: profileId }))
    settingsRef.current = updated
    setSettings(updated)
  }

  const analyze = async () => {
    if (busyRef.current || !canStartAnalysis(phase) || blocking || !activeProfile) return
    busyRef.current = true
    setPhase('analyzing')
    setPopupError(null)
    setFillResult(null)
    setReviewItems([])
    setDetectedFields(0)

    try {
      const tab = await getActiveTab()
      if (!tab?.id) throw new Error('CONTENT_UNAVAILABLE')
      let extraction: ExtractionResult
      try {
        const response = await sendTabMessage<ExtractionResult | { error?: string }>(tab.id, { type: 'EXTRACT_FIELDS' })
        if ('error' in response && response.error) throw new Error('CONTENT_UNAVAILABLE')
        extraction = response as ExtractionResult
      } catch {
        throw new Error('CONTENT_UNAVAILABLE')
      }

      setDetectedFields(extraction.fields.length)
      if (extraction.fields.length === 0) {
        setPhase('no-fields')
        return
      }

      const currentSnapshot: AnalysisSnapshot = {
        tabId: tab.id,
        url: tab.url,
        profileId: activeProfile.id,
        extraction
      }
      setSnapshot(currentSnapshot)
      const response = await sendRuntimeMessage<GenerateFieldSuggestionsResponse>({
        type: 'GENERATE_FIELD_SUGGESTIONS',
        payload: {
          pageContext: {
            url: extraction.url,
            title: extraction.title,
            hostname: (() => { try { return new URL(extraction.url).hostname } catch { return undefined } })()
          },
          fields: extraction.fields.map(toMetadata),
          activeProfileId: activeProfile.id,
          providerId: settings.provider.selectedProvider,
          privacyMode: privacyMode(settings),
          suggestionMode: settings.general.suggestionMode,
        }
      })

      if (!response.ok) {
        const invalid = ['INVALID_JSON', 'SCHEMA_VALIDATION_ERROR'].includes(response.error.code)
        setPopupError({
          kind: invalid ? 'invalid-response' : 'provider-unavailable',
          message: readableProviderError(response.error.message)
        })
        setPhase('error')
        return
      }
      setReviewItems(createReviewSuggestions(response.result.suggestions))
      setPhase('suggestions')
    } catch (error) {
      const contentUnavailable = error instanceof Error && error.message === 'CONTENT_UNAVAILABLE'
      setPopupError({
        kind: contentUnavailable ? 'content-unavailable' : 'provider-unavailable',
        message: contentUnavailable
          ? 'This page cannot be analyzed. Reload a normal webpage and try again.'
          : 'The selected provider is unavailable. Check its configuration and try again.'
      })
      setPhase('error')
    } finally {
      busyRef.current = false
    }
  }

  const updateReviewItem = (index: number, update: Partial<Pick<ReviewSuggestion, 'decision' | 'value'>>) => {
    setReviewItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...update } : item
    ))
  }

  const approveAll = () => {
    setReviewItems((current) => approveAllReviewSuggestions(current))
  }

  const fillApproved = async () => {
    if (busyRef.current || phase === 'filling' || summary.approved === 0 || !snapshot) return
    busyRef.current = true
    setPhase('filling')
    setPopupError(null)
    try {
      const tab = await getActiveTab()
      if (!tab?.id || !isAnalysisCurrent({
        analyzedTabId: snapshot.tabId,
        analyzedUrl: snapshot.url,
        analyzedProfileId: snapshot.profileId,
        currentTabId: tab.id,
        currentUrl: tab.url,
        currentProfileId: settings.activeProfileId
      })) {
        setPopupError({ kind: 'stale-analysis', message: 'The page or active profile changed. Analyze the form again.' })
        setPhase('error')
        return
      }

      const answers: FieldAnswer[] = reviewItems
        .filter((item) => item.decision === 'approved' && item.value.trim())
        .map((item) => ({
          locator: item.suggestion.fieldLocator,
          id: item.suggestion.fieldId,
          name: item.suggestion.fieldName,
          label: item.suggestion.fieldLabel,
          value: item.value,
          approved: true
        }))
      const response = await sendTabMessage<FillResult | { error?: string }>(tab.id, {
        type: 'FILL_FIELDS',
        answers
      })
      if ('error' in response && response.error) throw new Error(response.error)
      setFillResult(response as FillResult)
      setPhase('completed')
    } catch {
      setPopupError({ kind: 'fill-failed', message: 'Approved values could not be inserted. The page may have changed.' })
      setPhase('error')
    } finally {
      busyRef.current = false
    }
  }

  const renderBlockingState = () => {
    if (!blocking) return null
    const content = {
      setup: {
        title: 'Finish setup',
        text: 'Complete the short setup before analyzing forms.',
        action: 'Set up extension'
      },
      vault: {
        title: 'Vault locked',
        text: 'Unlock the vault in Settings before profile data can be used.',
        action: 'Unlock vault'
      },
      profile: {
        title: 'Profile required',
        text: 'Choose or create the profile to use on this page.',
        action: 'Choose or create profile'
      },
      provider: {
        title: 'Provider unavailable',
        text: 'Configure or start the selected suggestion provider.',
        action: 'Configure provider'
      }
    }[blocking.kind]
    return (
      <main className="popup-main">
        <section className="state-panel" aria-labelledby="blocking-title">
          <span className="status-badge">Action required</span>
          <h2 id="blocking-title">{content.title}</h2>
          <p>{content.text}</p>
          <button className="primary-button" onClick={() => openSection(blocking.section)}>{content.action}</button>
          {blocking.kind === 'setup' && (
            <button className="secondary-button" onClick={() => openSection('documents')}>Import a document</button>
          )}
        </section>
      </main>
    )
  }

  const renderOperationalState = () => {
    if (phase === 'loading') return <main className="popup-main" aria-live="polite"><p>Loading extension state…</p></main>
    if (phase === 'analyzing') return (
      <main className="popup-main" aria-live="polite">
        <section className="state-panel"><span className="spinner" aria-hidden="true" /><h2>Analyzing form</h2><p>{detectedFields ? `${detectedFields} supported fields detected. Creating suggestions…` : 'Detecting supported fields on this page…'}</p><button className="primary-button" disabled>Analysis in progress</button></section>
      </main>
    )
    if (phase === 'no-fields') return (
      <main className="popup-main" aria-live="polite"><section className="state-panel"><span className="status-badge">No supported fields</span><h2>Nothing to analyze</h2><p>No supported form fields were found on this page.</p><button className="primary-button" onClick={() => void analyze()}>Try again</button></section></main>
    )
    if (phase === 'error' && popupError) {
      const repairSection = errorSettingsSection(popupError.kind)
      return (
        <main className="popup-main" aria-live="assertive"><section className="state-panel error-panel"><span className="status-badge">Needs attention</span><h2>{popupError.kind === 'stale-analysis' ? 'Analysis is out of date' : 'Action failed'}</h2><p>{popupError.message}</p>{popupError.kind === 'stale-analysis' || popupError.kind === 'content-unavailable' || popupError.kind === 'fill-failed' ? <button className="primary-button" onClick={() => void analyze()}>Analyze again</button> : null}{repairSection && <button className="secondary-button" onClick={() => openSection(repairSection)}>Open relevant settings</button>}</section></main>
      )
    }
    if (phase === 'suggestions') return (
      <main className="popup-main" aria-live="polite">
        <section className="state-panel">
          <span className="status-badge">Analysis complete</span>
          <h2>{summary.total} suggestions</h2>
          <p>{summary.fillable} can be filled{summary.unresolved > 0 ? `; ${summary.unresolved} could not be matched.` : '.'}</p>
          {summary.approved === summary.fillable
            ? <button className="primary-button" disabled={summary.approved === 0} onClick={() => void fillApproved()}>Fill {summary.approved} approved</button>
            : <button className="primary-button" disabled={summary.fillable === 0} onClick={approveAll}>Approve all fillable</button>}
          <button className="secondary-button" onClick={() => setPhase('review')}>Review individually</button>
        </section>
      </main>
    )
    if (phase === 'review') return (
      <main className="popup-main review-main">
        <div className="review-heading"><div className="review-toolbar"><button className="text-button" onClick={() => setPhase('suggestions')} aria-label="Back to suggestion summary">← Back</button><button className="text-button" onClick={approveAll}>Approve all</button></div><h2>Review suggestions</h2><p>Approve only values you want inserted. Nothing is submitted.</p></div>
        <div className="review-list">
          {reviewItems.map((item, index) => {
            const field = fieldForSuggestion(snapshot, item.suggestion)
            const label = item.suggestion.fieldLabel ?? item.suggestion.fieldName ?? item.suggestion.fieldId
            const unresolved = item.suggestion.suggestedValue === null
            const uncertain = item.suggestion.confidence === 'low' || item.suggestion.warnings.length > 0
            return (
              <fieldset className="review-item" key={`${item.suggestion.fieldId}-${index}`} disabled={unresolved}>
                <legend>{label}</legend>
                <div className="review-meta">{field?.type === 'checkbox' ? 'Checkbox' : field?.type === 'radio' ? 'Radio choice' : field?.tag === 'select' ? 'Select option' : 'Text value'} · {item.suggestion.confidence} confidence{uncertain ? ' · Check carefully' : ''}{['sensitive', 'secret'].includes(item.suggestion.sensitivity) ? ' · Sensitive' : ''}</div>
                {unresolved ? <p className="unresolved">No reliable suggestion</p> : field?.tag === 'select' && field.options.length ? (
                  <select aria-label={`Value for ${label}`} value={item.value} onChange={(event) => updateReviewItem(index, { value: event.target.value })}>{!field.options.includes(item.value) && <option value={item.value}>{item.value}</option>}{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
                ) : field?.type === 'checkbox' ? (
                  <select aria-label={`Value for ${label}`} value={item.value} onChange={(event) => updateReviewItem(index, { value: event.target.value })}><option value="true">Checked</option><option value="false">Not checked</option></select>
                ) : <input aria-label={`Value for ${label}`} value={item.value} onChange={(event) => updateReviewItem(index, { value: event.target.value })} />}
                {!unresolved && <div className="approval-actions" aria-label={`Decision for ${label}`}><button type="button" className={item.decision === 'approved' ? 'decision selected' : 'decision'} aria-pressed={item.decision === 'approved'} onClick={() => updateReviewItem(index, { decision: 'approved' })}>Approve</button><button type="button" className={item.decision === 'rejected' ? 'decision rejected' : 'decision'} aria-pressed={item.decision === 'rejected'} onClick={() => updateReviewItem(index, { decision: 'rejected' })}>Reject</button></div>}
              </fieldset>
            )
          })}
        </div>
        <div className="sticky-actions"><button className="primary-button" disabled={summary.approved === 0} onClick={() => void fillApproved()}>Fill {summary.approved} approved</button></div>
      </main>
    )
    if (phase === 'filling') return <main className="popup-main" aria-live="polite"><section className="state-panel"><span className="spinner" aria-hidden="true" /><h2>Filling approved fields</h2><p>Keeping the page and controls in sync…</p><button className="primary-button" disabled>Fill in progress</button></section></main>
    if (phase === 'completed' && fillResult) return (
      <main className="popup-main" aria-live="polite"><section className="state-panel"><span className="status-badge success">Fill completed</span><h2>{fillResult.filled} fields filled</h2><dl className="summary-grid"><div><dt>Filled</dt><dd>{fillResult.filled}</dd></div><div><dt>Skipped</dt><dd>{summary.total - summary.approved}</dd></div><div><dt>Failed</dt><dd>{fillResult.skipped}</dd></div></dl><p>Review the webpage before submitting the form.</p><button className="secondary-button" onClick={() => void analyze()}>Analyze again</button></section></main>
    )
    return (
      <main className="popup-main">
        <section className="state-panel ready-panel">
          <span className="status-badge success">Ready</span>
          <h2>Analyze this page</h2>
          <p>Detect supported fields and prepare suggestions for your approval.</p>
          <div className="context-list"><span>Profile</span><strong>{activeProfile?.name}</strong><span>Provider</span><strong>{providerName(settings)}</strong><span>Page</span><strong>Current tab</strong></div>
          <button className="primary-button" disabled={!canStartAnalysis(phase)} onClick={() => void analyze()}>Analyze form</button>
          <button className="secondary-button" onClick={() => openSection('profiles')}>Manage profiles</button>
        </section>
      </main>
    )
  }

  const vaultEnabled = ['locked', 'unlocked'].includes(vaultStatus)
  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div><div className="product-name">Smart Form Filler</div><div className="header-status">{vaultEnabled ? `Vault ${vaultStatus}` : 'Approval-first filling'}</div></div>
        <button className="settings-button" onClick={() => openSection('overview')} aria-label="Open extension settings">Settings</button>
      </header>
      <div className="profile-bar">
        <label htmlFor="active-profile">Active profile</label>
        {profiles.length > 0 && !['locked', 'corrupted'].includes(vaultStatus) ? <select id="active-profile" value={settings.activeProfileId ?? ''} onChange={(event) => void changeProfile(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select> : <button id="active-profile" className="profile-link" onClick={() => openSection('profiles')}>{activeProfile?.name ?? 'None selected'}</button>}
      </div>
      {blocking ? renderBlockingState() : renderOperationalState()}
      <footer className="popup-footer"><button onClick={() => openSection('profiles')}>Profiles</button><button onClick={() => openSection('providers')}>Providers</button><button onClick={() => openSection('general')}>General</button></footer>
    </div>
  )
}
