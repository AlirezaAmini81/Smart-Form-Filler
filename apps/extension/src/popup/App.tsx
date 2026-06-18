import React, { useEffect, useMemo, useState } from 'react'
import type {
  FormAnalysisResult,
  FormFieldMetadata,
  SuggestedFieldValue,
  SuggestionSensitivity
} from '../../../../packages/shared/src/schemas'
import type { ExtractionResult } from '../lib/dom/extractFormFields'
import type { FieldAnswer, FillResult } from '../lib/dom/fillFormFields'
import type {
  BackgroundRequest,
  GenerateFieldSuggestionsResponse,
  ProviderStatusResponse
} from '../lib/messaging/types'
import type { LlmProviderStatusMap } from '../lib/llm/types'
import type {
  LlmProviderId,
  PrivacyMode,
  SuggestionWarning
} from '../features/suggestions/suggestionTypes'
import { createMockFormFields, normalizeFormFields } from '../features/suggestions/suggestionMapping'
import { DEFAULT_PROFILE, DEFAULT_PROFILE_ID } from '../features/suggestions/knowledgeRetriever'
import type { StoredKnowledgeBase } from '../features/suggestions/knowledgeTypes'
import {
  appendKnowledgeEntry,
  clearStoredKnowledgeBase,
  createChromeStorageAdapter,
  createDemoKnowledgeBase,
  loadStoredKnowledgeBase,
  saveStoredKnowledgeBase
} from '../features/suggestions/knowledgeStore'
import { DEMO_FORM_HTML, extractDemoFieldsFromHtml } from './demoExtraction'

type Analysis = FormAnalysisResult & {
  fields?: FormFieldMetadata[]
}

type PopupTab = 'extraction' | 'llm-demo'

type FieldSource = 'demo' | 'analysis'

type ReviewItem = {
  answer: FieldAnswer
  approved: boolean
}

type AppView = 'main' | 'review'

const PROVIDER_OPTIONS: Array<{ id: LlmProviderId; label: string; hint: string }> = [
  { id: 'ollama', label: 'Ollama (local)', hint: 'Local model via Ollama.' },
  { id: 'openai', label: 'OpenAI (cloud)', hint: 'Optional proxy with opt-in.' }
]

const SENSITIVITY_OPTIONS: SuggestionSensitivity[] = [
  'public',
  'normal',
  'sensitive',
  'secret'
]

function getPrivacyMode(providerId: LlmProviderId, cloudOptIn: boolean): PrivacyMode {
  if (providerId === 'openai') {
    return cloudOptIn ? 'cloud-opt-in' : 'local-only'
  }
  return 'local-only'
}

function sendRuntimeMessage<T>(message: BackgroundRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response as T)
    })
  })
}

export default function App() {
  const [activeTab, setActiveTab] = useState<PopupTab>('extraction')
  const [view, setView] = useState<AppView>('main')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [extractionStatus, setExtractionStatus] = useState<string>('Idle')

  const [providerId, setProviderId] = useState<LlmProviderId>('ollama')
  const [cloudOptIn, setCloudOptIn] = useState<boolean>(false)
  const [providerStatuses, setProviderStatuses] = useState<LlmProviderStatusMap | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestedFieldValue[]>([])
  const [warnings, setWarnings] = useState<SuggestionWarning[]>([])
  const [llmStatus, setLlmStatus] = useState<string>('Idle')
  const [llmError, setLlmError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [lastStatusRefresh, setLastStatusRefresh] = useState<string | null>(null)

  const storageAdapter = useMemo(() => createChromeStorageAdapter(), [])
  const [knowledgeBase, setKnowledgeBase] = useState<StoredKnowledgeBase | null>(null)
  const [knowledgeStatus, setKnowledgeStatus] = useState<string>('Storage idle')
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null)

  const [newEntryLabel, setNewEntryLabel] = useState<string>('')
  const [newEntryValue, setNewEntryValue] = useState<string>('')
  const [newEntrySensitivity, setNewEntrySensitivity] =
    useState<SuggestionSensitivity>('normal')

  const initialDemoFields = useMemo(
    () => extractDemoFieldsFromHtml(DEMO_FORM_HTML),
    []
  )
  const [demoFields, setDemoFields] = useState<FormFieldMetadata[]>(initialDemoFields)
  const [demoExtractionStatus, setDemoExtractionStatus] = useState<string>(
    `Extracted ${initialDemoFields.length} fields from demo HTML.`
  )
  const [fieldSource, setFieldSource] = useState<FieldSource>('demo')

  const privacyMode = useMemo(
    () => getPrivacyMode(providerId, cloudOptIn),
    [providerId, cloudOptIn]
  )

  const fallbackFields = useMemo(() => createMockFormFields(), [])
  const analysisFields = analysis?.fields?.length ? analysis.fields : null
  const selectedFields = useMemo(() => {
    if (fieldSource === 'analysis' && analysisFields?.length) {
      return analysisFields
    }
    return demoFields.length ? demoFields : fallbackFields
  }, [analysisFields, demoFields, fallbackFields, fieldSource])

  const normalizedFields = useMemo(() => normalizeFormFields(selectedFields), [selectedFields])
  const suggestionsByFieldId = useMemo(() => {
    return new Map(suggestions.map((suggestion) => [suggestion.fieldId, suggestion]))
  }, [suggestions])

  const cloudDisabled = providerId === 'openai' && !cloudOptIn
  const isStorageAvailable = Boolean(storageAdapter)

  const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    )
    return tabs[0] ?? null
  }

  const refreshProviderStatuses = async () => {
    try {
      const response = await sendRuntimeMessage<ProviderStatusResponse>({
        type: 'GET_LLM_PROVIDER_STATUS',
        payload: { privacyMode }
      })

      if (response.ok && typeof response.status === 'object' && response.status && 'ollama' in response.status) {
        setProviderStatuses(response.status)
      } else {
        setProviderStatuses(null)
      }
      setLastStatusRefresh(new Date().toLocaleTimeString())
    } catch (err) {
      setProviderStatuses(null)
    }
  }

  const refreshKnowledgeBase = async () => {
    if (!storageAdapter) {
      setKnowledgeStatus('Storage unavailable in this context.')
      setKnowledgeError('chrome.storage.local not available.')
      setKnowledgeBase(null)
      return
    }

    setKnowledgeStatus('Loading stored knowledge...')
    setKnowledgeError(null)

    try {
      const stored = await loadStoredKnowledgeBase(storageAdapter)
      setKnowledgeBase(stored)
      setKnowledgeStatus(stored ? 'Loaded stored knowledge.' : 'No stored knowledge yet.')
    } catch (err) {
      setKnowledgeStatus('Failed to load stored knowledge.')
      setKnowledgeError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const seedDemoKnowledge = async () => {
    if (!storageAdapter) {
      setKnowledgeError('chrome.storage.local not available.')
      return
    }

    const demo = createDemoKnowledgeBase()
    await saveStoredKnowledgeBase(storageAdapter, demo)
    setKnowledgeBase(demo)
    setKnowledgeStatus('Demo knowledge saved to storage.')
    setKnowledgeError(null)
  }

  const clearDemoKnowledge = async () => {
    if (!storageAdapter) {
      setKnowledgeError('chrome.storage.local not available.')
      return
    }

    await clearStoredKnowledgeBase(storageAdapter)
    setKnowledgeBase(null)
    setKnowledgeStatus('Stored knowledge cleared.')
    setKnowledgeError(null)
  }

  const addKnowledgeEntry = async () => {
    if (!storageAdapter) {
      setKnowledgeError('chrome.storage.local not available.')
      return
    }

    if (!newEntryLabel.trim()) {
      setKnowledgeError('Entry label is required.')
      return
    }

    const updated = await appendKnowledgeEntry({
      adapter: storageAdapter,
      profile: DEFAULT_PROFILE,
      entry: {
        label: newEntryLabel.trim(),
        value: newEntryValue.trim() || undefined,
        sensitivity: newEntrySensitivity
      }
    })

    if (updated) {
      setKnowledgeBase(updated)
      setKnowledgeStatus('Entry saved to storage.')
      setKnowledgeError(null)
      setNewEntryLabel('')
      setNewEntryValue('')
      setNewEntrySensitivity('normal')
    }
  }

  useEffect(() => {
    refreshProviderStatuses()
  }, [privacyMode])

  useEffect(() => {
    refreshKnowledgeBase()
  }, [storageAdapter])

  const analyze = async () => {
    setExtractionStatus('Analyzing page...')
    setExtraction(null)
    setFillResult(null)
    const tab = await getActiveTab()
    if (!tab?.id) {
      setExtractionStatus('No active tab')
      return
    }

    chrome.tabs.sendMessage(tab.id, { type: 'ANALYZE_PAGE' }, (resp) => {
      if (chrome.runtime.lastError) {
        setExtractionStatus('No content script - reload the page')
        return
      }
      setAnalysis(resp as Analysis)
      setExtractionStatus('Page analyzed')
    })
  }

  const extractFields = async () => {
    setExtractionStatus('Extracting form fields...')
    setAnalysis(null)
    setFillResult(null)
    const tab = await getActiveTab()
    if (!tab?.id) {
      setExtractionStatus('No active tab')
      return
    }

    chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_FIELDS' }, (resp) => {
      if (chrome.runtime.lastError) {
        setExtractionStatus('No content script - reload the page')
        return
      }
      if (resp?.error) {
        setExtractionStatus(`Error: ${resp.error}`)
        return
      }
      setExtraction(resp as ExtractionResult)
      setExtractionStatus(`Found ${resp.fields.length} field(s)`) 
    })
  }

  const simulateLLMAndReview = async () => {
    if (!extraction || extraction.fields.length === 0) {
      setExtractionStatus('Extract fields first')
      return
    }

    setExtractionStatus('Loading profile answers...')

    const stored = await new Promise<Record<string, unknown>>((resolve) =>
      chrome.storage.local.get(null, resolve)
    )

    const profiles = Object.values(stored) as Record<string, string>[]
    const profile = profiles[0]

    if (!profile) {
      setExtractionStatus('No profile saved - open Setup Assistant first')
      return
    }

    const answers: FieldAnswer[] = extraction.fields
      .map((field) => {
        const fieldLabelLower = (field.label || field.name || '').toLowerCase()

        const matchedKey = Object.keys(profile).find((key) => {
          const keyLower = key.toLowerCase()
          return (
            fieldLabelLower.includes(keyLower) ||
            keyLower.includes(fieldLabelLower) ||
            fieldLabelLower.split(' ').some((word) => word.length > 2 && keyLower.includes(word))
          )
        })

        if (!matchedKey) {
          return null
        }

        return {
          id: field.id || undefined,
          name: field.name || undefined,
          label: field.label,
          value: String(profile[matchedKey])
        } as FieldAnswer
      })
      .filter((answer): answer is FieldAnswer => answer !== null)

    if (answers.length === 0) {
      setExtractionStatus('No profile fields matched the form - check your profile')
      return
    }

    setReviewItems(answers.map((answer) => ({ answer, approved: true })))
    setView('review')
    setExtractionStatus(`${answers.length} field(s) ready to fill - review and approve`)
  }

  const toggleApproval = (index: number) => {
    setReviewItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, approved: !item.approved } : item
      )
    )
  }

  const confirmFill = async () => {
    const approvedAnswers = reviewItems
      .filter((item) => item.approved)
      .map((item) => item.answer)

    if (approvedAnswers.length === 0) {
      setExtractionStatus('No fields approved - tick at least one')
      return
    }

    setExtractionStatus('Filling form...')
    const tab = await getActiveTab()
    if (!tab?.id) {
      setExtractionStatus('No active tab')
      return
    }

    chrome.tabs.sendMessage(
      tab.id,
      { type: 'FILL_FIELDS', answers: approvedAnswers },
      (resp) => {
        if (chrome.runtime.lastError) {
          setExtractionStatus('No content script - reload the page')
          return
        }
        if (resp?.error) {
          setExtractionStatus(`Error: ${resp.error}`)
          return
        }
        setFillResult(resp as FillResult)
        setView('main')
        setExtractionStatus(`Filled ${resp.filled} field(s), skipped ${resp.skipped}`)
      }
    )
  }

  const extractDemoFields = () => {
    const extracted = extractDemoFieldsFromHtml(DEMO_FORM_HTML)
    setDemoFields(extracted)
    setDemoExtractionStatus(`Extracted ${extracted.length} fields from demo HTML.`)
  }

  const generateSuggestions = async () => {
    if (selectedFields.length === 0) {
      setLlmStatus('No fields available for suggestion generation.')
      return
    }

    setIsGenerating(true)
    setLlmError(null)
    setLlmStatus('Generating suggestions...')

    const pageContext = (() => {
      if (fieldSource === 'analysis' && analysis) {
        const url = analysis.url
        let hostname: string | undefined
        try {
          hostname = new URL(url).hostname
        } catch (e) {
          hostname = undefined
        }
        return {
          url: analysis.url,
          title: analysis.title,
          hostname
        }
      }

      return {
        url: 'https://demo.local/form',
        title: 'Demo form',
        hostname: 'demo.local'
      }
    })()

    try {
      const response = await sendRuntimeMessage<GenerateFieldSuggestionsResponse>({
        type: 'GENERATE_FIELD_SUGGESTIONS',
        payload: {
          pageContext,
          fields: selectedFields,
          activeProfileId: DEFAULT_PROFILE_ID,
          providerId,
          privacyMode
        }
      })

      if (response.ok) {
        setSuggestions(response.result.suggestions)
        setWarnings(response.result.warnings)
        setLlmStatus('Suggestions ready')
      } else {
        setSuggestions([])
        setWarnings([])
        setLlmStatus('Suggestion error')
        setLlmError(response.error.message)
      }
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : 'Unknown error')
      setLlmStatus('Suggestion error')
    } finally {
      setIsGenerating(false)
    }
  }

  if (view === 'review') {
    const approvedCount = reviewItems.filter((item) => item.approved).length
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 text-slate-900">
        <div className="w-[360px] px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setView('main')}
              className="text-slate-400 hover:text-slate-700 text-lg leading-none"
            >
              <-
            </button>
            <h2 className="text-base font-semibold">Review before filling</h2>
          </div>

          <p className="text-[12px] text-slate-500 mb-3">
            Uncheck any field you do not want to fill. Then click Confirm.
          </p>

          <div className="space-y-2 mb-4 max-h-[340px] overflow-y-auto pr-1">
            {reviewItems.map((item, index) => (
              <div
                key={index}
                onClick={() => toggleApproval(index)}
                className={`rounded-xl border p-3 cursor-pointer transition ${
                  item.approved
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-slate-200 bg-white/60 opacity-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div
                    className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border text-[10px] font-bold transition ${
                      item.approved
                        ? 'border-emerald-400 bg-emerald-400 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {item.approved ? '✓' : ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-700 truncate">
                      {item.answer.label || item.answer.name || item.answer.id || 'Unknown field'}
                    </div>
                    <div className="text-sm text-slate-900 font-medium mt-0.5 break-words">
                      {item.answer.value}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={confirmFill}
            disabled={approvedCount === 0}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            Confirm - fill {approvedCount} field{approvedCount !== 1 ? 's' : ''}
          </button>

          <button
            onClick={() => setView('main')}
            className="w-full mt-2 rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 transition hover:-translate-y-0.5"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 text-slate-900">
      <div className="w-[360px] px-4 py-3">
        <div className="fade-in flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Smart Form Filler</h1>
            <p className="text-xs text-slate-600">Local knowledge, human-reviewed suggestions</p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
            Local-first
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 rounded-xl border border-slate-200/70 bg-white/80 p-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
          <button
            className={`rounded-lg px-2 py-2 transition ${
              activeTab === 'extraction'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
            onClick={() => setActiveTab('extraction')}
          >
            Extraction
          </button>
          <button
            className={`rounded-lg px-2 py-2 transition ${
              activeTab === 'llm-demo'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
            onClick={() => setActiveTab('llm-demo')}
          >
            LLM Demo
          </button>
        </div>

        {activeTab === 'extraction' ? (
          <div className="mt-3 grid gap-2">
            <div className="grid gap-2">
              <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active profile</div>
                <div className="mt-1 text-sm font-medium text-slate-900">No profile selected</div>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Local LLM</div>
                <div className="mt-1 text-sm font-medium text-slate-900">Not connected</div>
              </div>
            </div>

            <div className="mt-1 grid gap-2">
              <button
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
                onClick={extractFields}
              >
                1 - Extract form fields
              </button>

              <button
                disabled={!extraction || extraction.fields.length === 0}
                className="w-full rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/20 transition hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                onClick={simulateLLMAndReview}
              >
                2 - Review &amp; fill form
              </button>

              <button
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5"
                onClick={analyze}
              >
                Analyze current page
              </button>
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Status
              </div>
              <div className="mt-1 text-sm text-slate-900">{extractionStatus}</div>
            </div>

            {analysis && (
              <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Analysis result
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-900">
                  <div className="font-semibold">{analysis.title}</div>
                  <div className="text-[11px] text-slate-500 break-all">{analysis.url}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                      Inputs
                      <div className="text-sm font-semibold text-slate-900">{analysis.inputs}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                      Textareas
                      <div className="text-sm font-semibold text-slate-900">{analysis.textareas}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                      Selects
                      <div className="text-sm font-semibold text-slate-900">{analysis.selects}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {extraction && (
              <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Extracted fields
                </div>
                <div className="mt-2 text-sm text-slate-900">
                  {extraction.fields.length} fields found, {extraction.skipped} skipped
                </div>
              </div>
            )}

            {fillResult && (
              <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Fill result
                </div>
                <div className="mt-2 text-sm text-slate-900">
                  Filled {fillResult.filled}, skipped {fillResult.skipped}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            <div className="grid gap-2">
              <div className="fade-in rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Active profile
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">{DEFAULT_PROFILE.name}</div>
                <div className="text-[11px] text-slate-500">Sensitivity: {DEFAULT_PROFILE.sensitivity}</div>
              </div>
              <div className="fade-in rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Vault</div>
                <div className="mt-1 text-sm font-medium text-slate-900">Vault locked</div>
              </div>
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>Connector status</span>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
                  onClick={refreshProviderStatuses}
                >
                  Refresh
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {PROVIDER_OPTIONS.map((option) => {
                  const status = providerStatuses?.[option.id]
                  const isActive = providerId === option.id
                  return (
                    <div
                      key={option.id}
                      className={`rounded-lg border px-2.5 py-2 ${
                        isActive
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>{option.label}</span>
                        <span className="uppercase text-[10px]">
                          {status?.available ? 'Ready' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px]">
                        {status?.details ?? 'Checking provider...'}
                      </div>
                      {status?.model && (
                        <div className="mt-1 text-[11px] text-slate-300">Model: {status.model}</div>
                      )}
                    </div>
                  )
                })}
              </div>
              {lastStatusRefresh && (
                <div className="mt-2 text-[11px] text-slate-500">Last check: {lastStatusRefresh}</div>
              )}
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Suggestion provider
              </div>
              <div className="mt-2">
                <select
                  aria-label="Select suggestion provider"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value as LlmProviderId)}
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-slate-500">
                  {PROVIDER_OPTIONS.find((option) => option.id === providerId)?.hint}
                </div>
              </div>

              {providerId === 'openai' && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <div className="font-semibold">Cloud mode warning</div>
                  <p className="mt-1">
                    Cloud mode may send selected form metadata and selected knowledge snippets to an
                    external API. Do not use secret profiles.
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={cloudOptIn}
                      onChange={(event) => setCloudOptIn(event.target.checked)}
                    />
                    I understand and want to enable cloud mode for this request.
                  </label>
                </div>
              )}
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Demo knowledge base
              </div>
              <div className="mt-2 text-sm text-slate-900">
                {knowledgeBase
                  ? `${knowledgeBase.entries.length} entries in storage`
                  : 'No stored entries yet'}
              </div>
              <div className="text-[11px] text-slate-500">
                Storage: {isStorageAvailable ? 'chrome.storage.local' : 'Unavailable'}
              </div>
              {knowledgeError && <div className="mt-1 text-[11px] text-rose-600">{knowledgeError}</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={seedDemoKnowledge}
                >
                  Seed demo knowledge
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={clearDemoKnowledge}
                >
                  Clear storage
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={refreshKnowledgeBase}
                >
                  Refresh
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Entry label (e.g. full name)"
                  value={newEntryLabel}
                  onChange={(event) => setNewEntryLabel(event.target.value)}
                />
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Entry value"
                  value={newEntryValue}
                  onChange={(event) => setNewEntryValue(event.target.value)}
                />
                <div className="flex gap-2">
                  <select
                    aria-label="Select entry sensitivity"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={newEntrySensitivity}
                    onChange={(event) =>
                      setNewEntrySensitivity(event.target.value as SuggestionSensitivity)
                    }
                  >
                    {SENSITIVITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white"
                    onClick={addKnowledgeEntry}
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">{knowledgeStatus}</div>
              {knowledgeBase?.entries?.length ? (
                <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                  {knowledgeBase.entries.slice(-4).map((entry) => (
                    <div key={entry.id}>
                      {entry.label}: {entry.value ?? 'No value'} ({entry.sensitivity})
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Demo extraction
              </div>
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                <pre className="whitespace-pre-wrap font-mono">{DEMO_FORM_HTML}</pre>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={extractDemoFields}
                >
                  Extract demo fields
                </button>
                <span className="text-[11px] text-slate-500">{demoExtractionStatus}</span>
              </div>

              <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Field source
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold ${
                    fieldSource === 'demo'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                  onClick={() => setFieldSource('demo')}
                >
                  Demo HTML
                </button>
                <button
                  className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold ${
                    fieldSource === 'analysis'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                  onClick={() => setFieldSource('analysis')}
                >
                  Current page
                </button>
              </div>
              {fieldSource === 'analysis' && !analysisFields?.length && (
                <div className="mt-2 text-[11px] text-amber-700">
                  Page field metadata is not available yet. Using demo fields instead.
                </div>
              )}
              <div className="mt-2 text-[11px] text-slate-500">
                Fields in use: {selectedFields.length}
              </div>
            </div>

            <div className="fade-in grid gap-2">
              <button
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={generateSuggestions}
                disabled={isGenerating || cloudDisabled}
              >
                {isGenerating ? 'Generating suggestions...' : 'Generate suggestions'}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-500">
                {providerId === 'openai'
                  ? 'Cloud mode is optional and disabled by default.'
                  : 'No data leaves your device in local mode.'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
              <div className="mt-1 text-sm text-slate-900">{llmStatus}</div>
              {llmError && <div className="mt-1 text-[11px] text-rose-600">{llmError}</div>}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Suggestions</div>
              {warnings.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  {warnings.map((warning, index) => (
                    <div key={`${warning.code}-${index}`}>- {warning.message}</div>
                  ))}
                </div>
              )}

              {suggestions.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.fieldId}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm font-semibold text-slate-900">
                        {suggestion.fieldLabel ?? suggestion.fieldId}
                      </div>
                      <div className="text-xs text-slate-500">{suggestion.fieldName}</div>
                      <div className="mt-2 text-sm text-slate-900">
                        {suggestion.suggestedValue ?? 'No suggestion'}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                        <span>Confidence: {suggestion.confidence}</span>
                        <span>Sensitivity: {suggestion.sensitivity}</span>
                        <span>Provider: {providerId}</span>
                      </div>
                      <div className="mt-2 text-[11px] text-slate-600">
                        {suggestion.reasoningSummary}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Provenance: {suggestion.provenance.knowledgeEntryIds.join(', ')}
                      </div>
                      {suggestion.warnings.length > 0 && (
                        <div className="mt-2 text-[11px] text-amber-700">
                          {suggestion.warnings.join(' | ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">No suggestions yet.</div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Demo suggestion overlay
              </div>
              <div className="mt-2 space-y-2">
                {normalizedFields.map((field) => {
                  const suggestion = suggestionsByFieldId.get(field.id)
                  return (
                    <div key={field.id} className="relative rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold text-slate-600">
                        {field.label ?? field.name ?? field.id}
                      </div>
                      <input
                        className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                        placeholder={field.placeholder ?? ''}
                        disabled
                      />
                      {suggestion ? (
                        <div className="absolute right-2 top-7 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          {suggestion.suggestedValue ?? 'No suggestion'}
                        </div>
                      ) : (
                        <div className="absolute right-2 top-7 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                          No match
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
import React, { useEffect, useMemo, useState } from 'react'
import type {
  FormAnalysisResult,
  FormFieldMetadata,
  SuggestedFieldValue,
  SuggestionSensitivity
} from '../../../../packages/shared/src/schemas'
import type { ExtractionResult } from '../lib/dom/extractFormFields'
import type { FieldAnswer, FillResult } from '../lib/dom/fillFormFields'
import type {
  BackgroundRequest,
  GenerateFieldSuggestionsResponse,
  ProviderStatusResponse
} from '../lib/messaging/types'
import type { LlmProviderStatusMap } from '../lib/llm/types'
import type {
  LlmProviderId,
  PrivacyMode,
  SuggestionWarning
} from '../features/suggestions/suggestionTypes'
import { createMockFormFields, normalizeFormFields } from '../features/suggestions/suggestionMapping'
import { DEFAULT_PROFILE, DEFAULT_PROFILE_ID } from '../features/suggestions/knowledgeRetriever'
import type { StoredKnowledgeBase } from '../features/suggestions/knowledgeTypes'
import {
  appendKnowledgeEntry,
  clearStoredKnowledgeBase,
  createChromeStorageAdapter,
  createDemoKnowledgeBase,
  loadStoredKnowledgeBase,
  saveStoredKnowledgeBase
} from '../features/suggestions/knowledgeStore'
import { DEMO_FORM_HTML, extractDemoFieldsFromHtml } from './demoExtraction'

type Analysis = FormAnalysisResult & {
  fields?: FormFieldMetadata[]
}

type PopupTab = 'extraction' | 'llm-demo'

type FieldSource = 'demo' | 'analysis'

type ReviewItem = {
  answer: FieldAnswer
  approved: boolean
}

type ExtractionView = 'main' | 'review'

const PROVIDER_OPTIONS: Array<{ id: LlmProviderId; label: string; hint: string }> = [
  { id: 'ollama', label: 'Ollama (local)', hint: 'Local model via Ollama.' },
  { id: 'openai', label: 'OpenAI (cloud)', hint: 'Optional proxy with opt-in.' }
]

const SENSITIVITY_OPTIONS: SuggestionSensitivity[] = [
  'public',
  'normal',
  'sensitive',
  'secret'
]

function getPrivacyMode(providerId: LlmProviderId, cloudOptIn: boolean): PrivacyMode {
  if (providerId === 'openai') {
    return cloudOptIn ? 'cloud-opt-in' : 'local-only'
  }
  return 'local-only'
}

function sendRuntimeMessage<T>(message: BackgroundRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response as T)
    })
  })
}

export default function App() {
  const [activeTab, setActiveTab] = useState<PopupTab>('extraction')
  const [view, setView] = useState<ExtractionView>('main')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [extractionStatus, setExtractionStatus] = useState<string>('Idle')

  const [providerId, setProviderId] = useState<LlmProviderId>('ollama')
  const [cloudOptIn, setCloudOptIn] = useState<boolean>(false)
  const [providerStatuses, setProviderStatuses] = useState<LlmProviderStatusMap | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestedFieldValue[]>([])
  const [warnings, setWarnings] = useState<SuggestionWarning[]>([])
  const [llmStatus, setLlmStatus] = useState<string>('Idle')
  const [llmError, setLlmError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [lastStatusRefresh, setLastStatusRefresh] = useState<string | null>(null)

  const storageAdapter = useMemo(() => createChromeStorageAdapter(), [])
  const [knowledgeBase, setKnowledgeBase] = useState<StoredKnowledgeBase | null>(null)
  const [knowledgeStatus, setKnowledgeStatus] = useState<string>('Storage idle')
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null)

  const [newEntryLabel, setNewEntryLabel] = useState<string>('')
  const [newEntryValue, setNewEntryValue] = useState<string>('')
  const [newEntrySensitivity, setNewEntrySensitivity] =
    useState<SuggestionSensitivity>('normal')

  const initialDemoFields = useMemo(
    () => extractDemoFieldsFromHtml(DEMO_FORM_HTML),
    []
  )
  const [demoFields, setDemoFields] = useState<FormFieldMetadata[]>(initialDemoFields)
  const [demoExtractionStatus, setDemoExtractionStatus] = useState<string>(
    `Extracted ${initialDemoFields.length} fields from demo HTML.`
  )
  const [fieldSource, setFieldSource] = useState<FieldSource>('demo')

  const privacyMode = useMemo(
    () => getPrivacyMode(providerId, cloudOptIn),
    [providerId, cloudOptIn]
  )

  const fallbackFields = useMemo(() => createMockFormFields(), [])
  const analysisFields = analysis?.fields?.length ? analysis.fields : null
  const selectedFields = useMemo(() => {
    if (fieldSource === 'analysis' && analysisFields?.length) {
      return analysisFields
    }
    return demoFields.length ? demoFields : fallbackFields
  }, [analysisFields, demoFields, fallbackFields, fieldSource])

  const normalizedFields = useMemo(() => normalizeFormFields(selectedFields), [selectedFields])
  const suggestionsByFieldId = useMemo(() => {
    return new Map(suggestions.map((suggestion) => [suggestion.fieldId, suggestion]))
  }, [suggestions])

  const cloudDisabled = providerId === 'openai' && !cloudOptIn
  const isStorageAvailable = Boolean(storageAdapter)

  const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    )
    return tabs[0] ?? null
  }

  const refreshProviderStatuses = async () => {
    try {
      const response = await sendRuntimeMessage<ProviderStatusResponse>({
        type: 'GET_LLM_PROVIDER_STATUS',
        payload: { privacyMode }
      })

      if (response.ok && typeof response.status === 'object' && response.status && 'ollama' in response.status) {
        setProviderStatuses(response.status)
      } else {
        setProviderStatuses(null)
      }
      setLastStatusRefresh(new Date().toLocaleTimeString())
    } catch (err) {
      setProviderStatuses(null)
    }
  }

  const refreshKnowledgeBase = async () => {
    if (!storageAdapter) {
      setKnowledgeStatus('Storage unavailable in this context.')
      setKnowledgeError('chrome.storage.local not available.')
      setKnowledgeBase(null)
      return
    }

    setKnowledgeStatus('Loading stored knowledge...')
    setKnowledgeError(null)

    try {
      const stored = await loadStoredKnowledgeBase(storageAdapter)
      setKnowledgeBase(stored)
      setKnowledgeStatus(stored ? 'Loaded stored knowledge.' : 'No stored knowledge yet.')
    } catch (err) {
      setKnowledgeStatus('Failed to load stored knowledge.')
      setKnowledgeError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const seedDemoKnowledge = async () => {
    if (!storageAdapter) {
      setKnowledgeError('chrome.storage.local not available.')
      return
    }

    const demo = createDemoKnowledgeBase()
    await saveStoredKnowledgeBase(storageAdapter, demo)
    setKnowledgeBase(demo)
    setKnowledgeStatus('Demo knowledge saved to storage.')
    setKnowledgeError(null)
  }

  const clearDemoKnowledge = async () => {
    if (!storageAdapter) {
      setKnowledgeError('chrome.storage.local not available.')
      return
    }

    await clearStoredKnowledgeBase(storageAdapter)
    setKnowledgeBase(null)
    setKnowledgeStatus('Stored knowledge cleared.')
    setKnowledgeError(null)
  }

  const addKnowledgeEntry = async () => {
    if (!storageAdapter) {
      setKnowledgeError('chrome.storage.local not available.')
      return
    }

    if (!newEntryLabel.trim()) {
      setKnowledgeError('Entry label is required.')
      return
    }

    const updated = await appendKnowledgeEntry({
      adapter: storageAdapter,
      profile: DEFAULT_PROFILE,
      entry: {
        label: newEntryLabel.trim(),
        value: newEntryValue.trim() || undefined,
        sensitivity: newEntrySensitivity
      }
    })

    if (updated) {
      setKnowledgeBase(updated)
      setKnowledgeStatus('Entry saved to storage.')
      setKnowledgeError(null)
      setNewEntryLabel('')
      setNewEntryValue('')
      setNewEntrySensitivity('normal')
    }
  }

  useEffect(() => {
    refreshProviderStatuses()
  }, [privacyMode])

  useEffect(() => {
    refreshKnowledgeBase()
  }, [storageAdapter])

  const analyze = async () => {
    setExtractionStatus('Analyzing page...')
    setExtraction(null)
    setFillResult(null)
    const tab = await getActiveTab()
    if (!tab?.id) {
      setExtractionStatus('No active tab')
      return
    }
    chrome.tabs.sendMessage(tab.id, { type: 'ANALYZE_PAGE' }, (resp) => {
      if (chrome.runtime.lastError) {
        setExtractionStatus('No content script - reload the page')
        return
      }
      setAnalysis(resp as Analysis)
      setExtractionStatus('Page analyzed')
    })
  }

  const extractFields = async () => {
    setExtractionStatus('Extracting form fields...')
    setAnalysis(null)
    setFillResult(null)
    const tab = await getActiveTab()
    if (!tab?.id) {
      setExtractionStatus('No active tab')
      return
    }
    chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_FIELDS' }, (resp) => {
      if (chrome.runtime.lastError) {
        setExtractionStatus('No content script - reload the page')
        return
      }
      if (resp?.error) {
        setExtractionStatus(`Error: ${resp.error}`)
        return
      }
      setExtraction(resp as ExtractionResult)
      setExtractionStatus(`Found ${resp.fields.length} field(s)`) 
    })
  }

  const simulateLLMAndReview = async () => {
    if (!extraction || extraction.fields.length === 0) {
      setExtractionStatus('Extract fields first')
      return
    }

    setExtractionStatus('Loading profile answers...')

    const stored = await new Promise<Record<string, unknown>>((resolve) =>
      chrome.storage.local.get(null, resolve)
    )

    const profiles = Object.values(stored) as Record<string, string>[]
    const profile = profiles[0]

    if (!profile) {
      setExtractionStatus('No profile saved - open Setup Assistant first')
      return
    }

    const answers: FieldAnswer[] = extraction.fields
      .map((field) => {
        const fieldLabelLower = (field.label || field.name || '').toLowerCase()

        const matchedKey = Object.keys(profile).find((key) => {
          const keyLower = key.toLowerCase()
          return (
            fieldLabelLower.includes(keyLower) ||
            keyLower.includes(fieldLabelLower) ||
            fieldLabelLower.split(' ').some((word) => word.length > 2 && keyLower.includes(word))
          )
        })

        if (!matchedKey) {
          return null
        }

        return {
          id: field.id || undefined,
          name: field.name || undefined,
          label: field.label,
          value: String(profile[matchedKey])
        } as FieldAnswer
      })
      .filter((answer): answer is FieldAnswer => answer !== null)

    if (answers.length === 0) {
      setExtractionStatus('No profile fields matched the form - check your profile')
      return
    }

    setReviewItems(answers.map((answer) => ({ answer, approved: true })))
    setView('review')
    setExtractionStatus(`${answers.length} field(s) ready to fill - review and approve`)
  }

  const toggleApproval = (index: number) => {
    setReviewItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, approved: !item.approved } : item
      )
    )
  }

  const confirmFill = async () => {
    const approvedAnswers = reviewItems
      .filter((item) => item.approved)
      .map((item) => item.answer)

    if (approvedAnswers.length === 0) {
      setExtractionStatus('No fields approved - tick at least one')
      return
    }

    setExtractionStatus('Filling form...')
    const tab = await getActiveTab()
    if (!tab?.id) {
      setExtractionStatus('No active tab')
      return
    }

    chrome.tabs.sendMessage(
      tab.id,
      { type: 'FILL_FIELDS', answers: approvedAnswers },
      (resp) => {
        if (chrome.runtime.lastError) {
          setExtractionStatus('No content script - reload the page')
          return
        }
        if (resp?.error) {
          setExtractionStatus(`Error: ${resp.error}`)
          return
        }
        setFillResult(resp as FillResult)
        setView('main')
        setExtractionStatus(`Filled ${resp.filled} field(s), skipped ${resp.skipped}`)
      }
    )
  }

  const extractDemoFields = () => {
    const extracted = extractDemoFieldsFromHtml(DEMO_FORM_HTML)
    setDemoFields(extracted)
    setDemoExtractionStatus(`Extracted ${extracted.length} fields from demo HTML.`)
  }

  const generateSuggestions = async () => {
    if (selectedFields.length === 0) {
      setLlmStatus('No fields available for suggestion generation.')
      return
    }

    setIsGenerating(true)
    setLlmError(null)
    setLlmStatus('Generating suggestions...')

    const pageContext = (() => {
      if (fieldSource === 'analysis' && analysis) {
        const url = analysis.url
        let hostname: string | undefined
        try {
          hostname = new URL(url).hostname
        } catch (e) {
          hostname = undefined
        }
        return {
          url: analysis.url,
          title: analysis.title,
          hostname
        }
      }

      return {
        url: 'https://demo.local/form',
        title: 'Demo form',
        hostname: 'demo.local'
      }
    })()

    try {
      const response = await sendRuntimeMessage<GenerateFieldSuggestionsResponse>({
        type: 'GENERATE_FIELD_SUGGESTIONS',
        payload: {
          pageContext,
          fields: selectedFields,
          activeProfileId: DEFAULT_PROFILE_ID,
          providerId,
          privacyMode
        }
      })

      if (response.ok) {
        setSuggestions(response.result.suggestions)
        setWarnings(response.result.warnings)
        setLlmStatus('Suggestions ready')
      } else {
        setSuggestions([])
        setWarnings([])
        setLlmStatus('Suggestion error')
        setLlmError(response.error.message)
      }
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : 'Unknown error')
      setLlmStatus('Suggestion error')
    } finally {
      setIsGenerating(false)
    }
  }

  if (view === 'review') {
    const approvedCount = reviewItems.filter((item) => item.approved).length
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 text-slate-900">
        <div className="w-[360px] px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setView('main')}
              className="text-slate-400 hover:text-slate-700 text-lg leading-none"
            >
              <-
            </button>
            <h2 className="text-base font-semibold">Review before filling</h2>
          </div>

          <p className="text-[12px] text-slate-500 mb-3">
            Uncheck any field you do not want to fill. Then click Confirm.
          </p>

          <div className="space-y-2 mb-4 max-h-[340px] overflow-y-auto pr-1">
            {reviewItems.map((item, index) => (
              <div
                key={`${item.answer.label ?? item.answer.name ?? 'field'}-${index}`}
                onClick={() => toggleApproval(index)}
                className={`rounded-xl border p-3 cursor-pointer transition ${
                  item.approved
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-slate-200 bg-white/60 opacity-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div
                    className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border text-[10px] font-bold transition ${
                      item.approved
                        ? 'border-emerald-400 bg-emerald-400 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {item.approved ? '✓' : ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-700 truncate">
                      {item.answer.label || item.answer.name || item.answer.id || 'Unknown field'}
                    </div>
                    <div className="text-sm text-slate-900 font-medium mt-0.5 break-words">
                      {item.answer.value}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={confirmFill}
            disabled={approvedCount === 0}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            Confirm - fill {approvedCount} field{approvedCount !== 1 ? 's' : ''}
          </button>

          <button
            onClick={() => setView('main')}
            className="w-full mt-2 rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-600 transition hover:-translate-y-0.5"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 text-slate-900">
      <div className="w-[360px] px-4 py-3">
        <div className="fade-in flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Smart Form Filler</h1>
            <p className="text-xs text-slate-600">Local knowledge, human-reviewed suggestions</p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
            Local-first
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 rounded-xl border border-slate-200/70 bg-white/80 p-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
          <button
            className={`rounded-lg px-2 py-2 transition ${
              activeTab === 'extraction'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
            onClick={() => setActiveTab('extraction')}
          >
            Extraction
          </button>
          <button
            className={`rounded-lg px-2 py-2 transition ${
              activeTab === 'llm-demo'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
            onClick={() => setActiveTab('llm-demo')}
          >
            LLM Demo
          </button>
        </div>

        {activeTab === 'extraction' ? (
          <div className="mt-3 grid gap-2">
            <div className="grid gap-2">
              <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Active profile
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">No profile selected</div>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Local LLM</div>
                <div className="mt-1 text-sm font-medium text-slate-900">Not connected</div>
              </div>
            </div>

            <button
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
              onClick={extractFields}
            >
              1 - Extract form fields
            </button>
            <button
              disabled={!extraction || extraction.fields.length === 0}
              className="w-full rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/20 transition hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              onClick={simulateLLMAndReview}
            >
              2 - Review and fill form
            </button>
            <button
              className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5"
              onClick={analyze}
            >
              Analyze current page
            </button>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Status
              </div>
              <div className="mt-1 text-sm text-slate-900">{extractionStatus}</div>
            </div>

            {analysis && (
              <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Analysis result
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-900">
                  <div className="font-semibold">{analysis.title}</div>
                  <div className="text-[11px] text-slate-500 break-all">{analysis.url}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                      Inputs
                      <div className="text-sm font-semibold text-slate-900">{analysis.inputs}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                      Textareas
                      <div className="text-sm font-semibold text-slate-900">{analysis.textareas}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                      Selects
                      <div className="text-sm font-semibold text-slate-900">{analysis.selects}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {extraction && (
              <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Extraction result
                </div>
                <div className="mt-2 text-sm text-slate-900">
                  Fields: {extraction.fields.length}, skipped: {extraction.skipped}
                </div>
              </div>
            )}

            {fillResult && (
              <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Fill result
                </div>
                <div className="mt-2 text-sm text-slate-900">
                  Filled: {fillResult.filled}, skipped: {fillResult.skipped}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            <div className="grid gap-2">
              <div className="fade-in rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Active profile
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">{DEFAULT_PROFILE.name}</div>
                <div className="text-[11px] text-slate-500">Sensitivity: {DEFAULT_PROFILE.sensitivity}</div>
              </div>
              <div className="fade-in rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Vault</div>
                <div className="mt-1 text-sm font-medium text-slate-900">Vault locked</div>
              </div>
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>Connector status</span>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
                  onClick={refreshProviderStatuses}
                >
                  Refresh
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {PROVIDER_OPTIONS.map((option) => {
                  const status = providerStatuses?.[option.id]
                  const isActive = providerId === option.id
                  return (
                    <div
                      key={option.id}
                      className={`rounded-lg border px-2.5 py-2 ${
                        isActive
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>{option.label}</span>
                        <span className="uppercase text-[10px]">
                          {status?.available ? 'Ready' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px]">
                        {status?.details ?? 'Checking provider...'}
                      </div>
                      {status?.model && (
                        <div className="mt-1 text-[11px] text-slate-300">Model: {status.model}</div>
                      )}
                    </div>
                  )
                })}
              </div>
              {lastStatusRefresh && (
                <div className="mt-2 text-[11px] text-slate-500">Last check: {lastStatusRefresh}</div>
              )}
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Suggestion provider
              </div>
              <div className="mt-2">
                <select
                  aria-label="Select suggestion provider"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value as LlmProviderId)}
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-slate-500">
                  {PROVIDER_OPTIONS.find((option) => option.id === providerId)?.hint}
                </div>
              </div>

              {providerId === 'openai' && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <div className="font-semibold">Cloud mode warning</div>
                  <p className="mt-1">
                    Cloud mode may send selected form metadata and selected knowledge snippets to an
                    external API. Do not use secret profiles.
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={cloudOptIn}
                      onChange={(event) => setCloudOptIn(event.target.checked)}
                    />
                    I understand and want to enable cloud mode for this request.
                  </label>
                </div>
              )}
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Demo knowledge base
              </div>
              <div className="mt-2 text-sm text-slate-900">
                {knowledgeBase
                  ? `${knowledgeBase.entries.length} entries in storage`
                  : 'No stored entries yet'}
              </div>
              <div className="text-[11px] text-slate-500">
                Storage: {isStorageAvailable ? 'chrome.storage.local' : 'Unavailable'}
              </div>
              {knowledgeError && <div className="mt-1 text-[11px] text-rose-600">{knowledgeError}</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={seedDemoKnowledge}
                >
                  Seed demo knowledge
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={clearDemoKnowledge}
                >
                  Clear storage
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={refreshKnowledgeBase}
                >
                  Refresh
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Entry label (e.g. full name)"
                  value={newEntryLabel}
                  onChange={(event) => setNewEntryLabel(event.target.value)}
                />
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Entry value"
                  value={newEntryValue}
                  onChange={(event) => setNewEntryValue(event.target.value)}
                />
                <div className="flex gap-2">
                  <select
                    aria-label="Select entry sensitivity"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={newEntrySensitivity}
                    onChange={(event) =>
                      setNewEntrySensitivity(event.target.value as SuggestionSensitivity)
                    }
                  >
                    {SENSITIVITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white"
                    onClick={addKnowledgeEntry}
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">{knowledgeStatus}</div>
              {knowledgeBase?.entries?.length ? (
                <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                  {knowledgeBase.entries.slice(-4).map((entry) => (
                    <div key={entry.id}>
                      {entry.label}: {entry.value ?? 'No value'} ({entry.sensitivity})
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="fade-in rounded-xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Demo extraction
              </div>
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                <pre className="whitespace-pre-wrap font-mono">{DEMO_FORM_HTML}</pre>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={extractDemoFields}
                >
                  Extract demo fields
                </button>
                <span className="text-[11px] text-slate-500">{demoExtractionStatus}</span>
              </div>

              <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Field source
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold ${
                    fieldSource === 'demo'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                  onClick={() => setFieldSource('demo')}
                >
                  Demo HTML
                </button>
                <button
                  className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold ${
                    fieldSource === 'analysis'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                  onClick={() => setFieldSource('analysis')}
                >
                  Current page
                </button>
              </div>
              {fieldSource === 'analysis' && !analysisFields?.length && (
                <div className="mt-2 text-[11px] text-amber-700">
                  Page field metadata is not available yet. Using demo fields instead.
                </div>
              )}
              <div className="mt-2 text-[11px] text-slate-500">
                Fields in use: {selectedFields.length}
              </div>
            </div>

            <div className="fade-in grid gap-2">
              <button
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={generateSuggestions}
                disabled={isGenerating || cloudDisabled}
              >
                {isGenerating ? 'Generating suggestions...' : 'Generate suggestions'}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-500">
                {providerId === 'openai'
                  ? 'Cloud mode is optional and disabled by default.'
                  : 'No data leaves your device in local mode.'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
              <div className="mt-1 text-sm text-slate-900">{llmStatus}</div>
              {llmError && <div className="mt-1 text-[11px] text-rose-600">{llmError}</div>}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Suggestions</div>
              {warnings.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  {warnings.map((warning, index) => (
                    <div key={`${warning.code}-${index}`}>- {warning.message}</div>
                  ))}
                </div>
              )}

              {suggestions.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.fieldId}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm font-semibold text-slate-900">
                        {suggestion.fieldLabel ?? suggestion.fieldId}
                      </div>
                      <div className="text-xs text-slate-500">{suggestion.fieldName}</div>
                      <div className="mt-2 text-sm text-slate-900">
                        {suggestion.suggestedValue ?? 'No suggestion'}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                        <span>Confidence: {suggestion.confidence}</span>
                        <span>Sensitivity: {suggestion.sensitivity}</span>
                        <span>Provider: {providerId}</span>
                      </div>
                      <div className="mt-2 text-[11px] text-slate-600">
                        {suggestion.reasoningSummary}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Provenance: {suggestion.provenance.knowledgeEntryIds.join(', ')}
                      </div>
                      {suggestion.warnings.length > 0 && (
                        <div className="mt-2 text-[11px] text-amber-700">
                          {suggestion.warnings.join(' | ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">No suggestions yet.</div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Demo suggestion overlay
              </div>
              <div className="mt-2 space-y-2">
                {normalizedFields.map((field) => {
                  const suggestion = suggestionsByFieldId.get(field.id)
                  return (
                    <div key={field.id} className="relative rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold text-slate-600">
                        {field.label ?? field.name ?? field.id}
                      </div>
                      <input
                        className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                        placeholder={field.placeholder ?? ''}
                        disabled
                      />
                      {suggestion ? (
                        <div className="absolute right-2 top-7 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          {suggestion.suggestedValue ?? 'No suggestion'}
                        </div>
                      ) : (
                        <div className="absolute right-2 top-7 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                          No match
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
