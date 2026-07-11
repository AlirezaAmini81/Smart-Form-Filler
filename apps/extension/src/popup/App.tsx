import React, { useEffect, useMemo, useState } from 'react'
import type {
  FormAnalysisResult,
  FormFieldMetadata,
  SuggestionConfidence,
  SuggestedFieldValue,
  SuggestionSensitivity
} from '../../../../packages/shared/src/schemas'
import type { ExtractionResult, FormField } from '../lib/dom/extractFormFields'
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
  SuggestionGenerationResult,
  SuggestionWarning
} from '../features/suggestions/suggestionTypes'
import { DEFAULT_PROFILE, DEFAULT_PROFILE_ID, normalizeTokens } from '../features/suggestions/knowledgeRetriever'
import type { KnowledgeEntry, StoredKnowledgeBase } from '../features/suggestions/knowledgeTypes'
import {
  appendKnowledgeEntry,
  clearStoredKnowledgeBase,
  createChromeStorageAdapter,
  loadStoredKnowledgeBase
} from '../features/suggestions/knowledgeStore'

type Analysis = FormAnalysisResult & {
  fields?: FormFieldMetadata[]
}

type PopupTab = 'main' | 'dev'

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

const PRIVACY_LEVELS = [
  {
    value: 0,
    label: 'Low',
    hint: 'Share all profile data with the local model.'
  },
  {
    value: 1,
    label: 'Balanced',
    hint: 'Share matched entries and trimmed fields.'
  },
  {
    value: 2,
    label: 'High',
    hint: 'Share minimal, filtered data.'
  }
]

const CONFIDENCE_LEVELS: SuggestionConfidence[] = ['low', 'medium', 'high']

function confidenceRank(confidence: SuggestionConfidence): number {
  const index = CONFIDENCE_LEVELS.indexOf(confidence)
  return index >= 0 ? index : 0
}

function confidenceLabel(rank: number): string {
  return CONFIDENCE_LEVELS[Math.min(CONFIDENCE_LEVELS.length - 1, Math.max(0, rank))]
}

function confidenceScore(confidence: SuggestionConfidence): number {
  switch (confidence) {
    case 'high':
      return 0.9
    case 'medium':
      return 0.6
    case 'low':
    default:
      return 0.2
  }
}

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

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response as T)
    })
  })
}

function mapExtractionToMetadata(fields: FormField[]): FormFieldMetadata[] {
  return fields.map((field) => ({
    id: field.id || undefined,
    name: field.name || undefined,
    label: field.label || undefined,
    placeholder: field.placeholder || undefined,
    ariaLabel: undefined,
    type: field.type || undefined,
    value: field.value || undefined,
    options: field.options.length ? field.options : undefined,
    kind: field.tag === 'textarea' ? 'textarea' : field.tag === 'select' ? 'select' : 'input'
  }))
}

function scoreEntry(field: FormField, entryLabel: string, entryValue?: string): number {
  const fieldTokens = new Set(
    normalizeTokens([field.label, field.name, field.placeholder, field.type].filter(Boolean).join(' '))
  )
  const entryTokens = new Set(normalizeTokens([entryLabel, entryValue].filter(Boolean).join(' ')))
  let score = 0
  fieldTokens.forEach((token) => {
    if (entryTokens.has(token)) {
      score += 1
    }
  })
  return score
}

export default function App() {
  const [activeTab, setActiveTab] = useState<PopupTab>('main')
  const [view, setView] = useState<AppView>('main')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [extractionStatus, setExtractionStatus] = useState<string>('Idle')

  const [providerId, setProviderId] = useState<LlmProviderId>('ollama')
  const [cloudOptIn, setCloudOptIn] = useState<boolean>(false)
  const [privacyLevel, setPrivacyLevel] = useState<number>(1)
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaModel, setOllamaModel] = useState<string>('')
  const [providerStatuses, setProviderStatuses] = useState<LlmProviderStatusMap | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestedFieldValue[]>([])
  const [debugInfo, setDebugInfo] = useState<SuggestionGenerationResult['debug'] | null>(null)
  const [warnings, setWarnings] = useState<SuggestionWarning[]>([])
  const [llmStatus, setLlmStatus] = useState<string>('Idle')
  const [llmError, setLlmError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState<boolean>(false)

  const storageAdapter = useMemo(() => createChromeStorageAdapter(), [])
  const [knowledgeBase, setKnowledgeBase] = useState<StoredKnowledgeBase | null>(null)
  const [knowledgeStatus, setKnowledgeStatus] = useState<string>('Storage idle')
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null)

  const [newEntryLabel, setNewEntryLabel] = useState<string>('')
  const [newEntryValue, setNewEntryValue] = useState<string>('')
  const [newEntrySensitivity, setNewEntrySensitivity] =
    useState<SuggestionSensitivity>('normal')

  const [activeProfileId, setActiveProfileId] = useState<string>(DEFAULT_PROFILE_ID)

  const privacyMode = useMemo(
    () => getPrivacyMode(providerId, cloudOptIn),
    [providerId, cloudOptIn]
  )

  const privacySetting = PRIVACY_LEVELS[privacyLevel] ?? PRIVACY_LEVELS[1]
  const confidenceSetting = confidenceLabel(confidenceThreshold)

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((suggestion) =>
      confidenceRank(suggestion.confidence) >= confidenceThreshold
    )
  }, [suggestions, confidenceThreshold])

  const activeProfileEntries = useMemo(() => {
    return knowledgeBase?.entries?.filter((entry) => entry.profileId === activeProfileId) ?? []
  }, [knowledgeBase, activeProfileId])

  const fieldMatches = useMemo(() => {
    if (!extraction?.fields?.length) {
      return [] as Array<{ field: FormField; matches: Array<{ entry: KnowledgeEntry; score: number }> }>
    }

    return extraction.fields.map((field) => {
      const matches = activeProfileEntries
        .map((entry) => ({ entry, score: scoreEntry(field, entry.label, entry.value) }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)

      return { field, matches }
    })
  }, [extraction, activeProfileEntries])

  const profiles = useMemo(() => {
    if (knowledgeBase?.profiles?.length) {
      return knowledgeBase.profiles
    }
    return [DEFAULT_PROFILE]
  }, [knowledgeBase])

  const activeProfile = useMemo(() => {
    return profiles.find((profile) => profile.id === activeProfileId) ?? DEFAULT_PROFILE
  }, [profiles, activeProfileId])

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === activeProfileId)) {
      setActiveProfileId(profiles[0]?.id ?? DEFAULT_PROFILE_ID)
    }
  }, [profiles, activeProfileId])

  const cloudDisabled = providerId === 'openai' && !cloudOptIn

  const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    )
    return tabs[0] ?? null
  }

  const openSetupAssistant = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') })
  }

  const refreshProviderStatuses = async () => {
    try {
      const response = await sendRuntimeMessage<ProviderStatusResponse>({
        type: 'GET_LLM_PROVIDER_STATUS',
        payload: { privacyMode }
      })

      if (response.ok && typeof response.status === 'object' && response.status && 'ollama' in response.status) {
        const statusMap = response.status as LlmProviderStatusMap
        setProviderStatuses(statusMap)
        const ollamaStatus = statusMap.ollama
        if (ollamaStatus?.models) {
          setOllamaModels(ollamaStatus.models)
          setOllamaModel((prev) => {
            if (prev && ollamaStatus.models?.includes(prev)) {
              return prev
            }
            return ollamaStatus.model ?? ollamaStatus.models?.[0] ?? prev
          })
        }
      } else {
        setProviderStatuses(null)
      }
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
      profile: activeProfile,
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
    if (providerId !== 'ollama') {
      return
    }
    if (!ollamaModel && ollamaModels.length > 0) {
      setOllamaModel(ollamaModels[0])
    }
  }, [providerId, ollamaModel, ollamaModels])

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

    try {
      const resp = await sendTabMessage<Analysis>(tab.id, { type: 'ANALYZE_PAGE' })
      setAnalysis(resp)
      setExtractionStatus('Page analyzed')
    } catch (error) {
      setExtractionStatus('No content script - reload the page')
    }
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

    try {
      const resp = await sendTabMessage<ExtractionResult | { error?: string }>(tab.id, {
        type: 'EXTRACT_FIELDS'
      })

      if (resp && 'error' in resp && resp.error) {
        setExtractionStatus(`Error: ${resp.error}`)
        return
      }

      const result = resp as ExtractionResult
      setExtraction(result)
      setExtractionStatus(`Found ${result.fields.length} field(s)`)
    } catch (error) {
      setExtractionStatus('No content script - reload the page')
    }
  }

  const simulateLLMAndReview = async () => {
    if (!extraction || extraction.fields.length === 0) {
      setExtractionStatus('Extract fields first')
      return
    }

    if (!knowledgeBase?.entries?.length) {
      setExtractionStatus('No knowledge entries yet - open Setup Assistant')
      return
    }

    const entries = ((knowledgeBase.entries ?? []) as Array<{
      profileId: string
      label: string
      value?: string
    }>).filter((entry) => entry.profileId === activeProfileId)

    if (entries.length === 0) {
      setExtractionStatus('No entries for selected profile')
      return
    }

    const answers: FieldAnswer[] = extraction.fields
      .map((field) => {
        let bestScore = 0
        let bestValue: string | undefined

        entries.forEach((entry) => {
          const score = scoreEntry(field, entry.label, entry.value)
          if (score > bestScore) {
            bestScore = score
            bestValue = entry.value
          }
        })

        if (!bestValue || bestScore === 0) {
          return null
        }

        return {
          id: field.id || undefined,
          name: field.name || undefined,
          label: field.label,
          value: bestValue
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

    try {
      const resp = await sendTabMessage<FillResult | { error?: string }>(tab.id, {
        type: 'FILL_FIELDS',
        answers: approvedAnswers
      })

      if (resp && 'error' in resp && resp.error) {
        setExtractionStatus(`Error: ${resp.error}`)
        return
      }

      const result = resp as FillResult
      setFillResult(result)
      setView('main')
      setExtractionStatus(`Filled ${result.filled} field(s), skipped ${result.skipped}`)
    } catch (error) {
      setExtractionStatus('No content script - reload the page')
    }
  }

  const generateSuggestions = async (fields: FormFieldMetadata[], pageContext: Analysis) => {
    setIsGenerating(true)
    setLlmError(null)
    setLlmStatus('Generating suggestions...')

    try {
      const response = await sendRuntimeMessage<GenerateFieldSuggestionsResponse>({
        type: 'GENERATE_FIELD_SUGGESTIONS',
        payload: {
          pageContext: {
            url: pageContext.url,
            title: pageContext.title,
            hostname: (() => {
              try {
                return new URL(pageContext.url).hostname
              } catch (e) {
                return undefined
              }
            })()
          },
          fields,
          activeProfileId,
          providerId,
          privacyMode,
          privacyLevel,
          ollamaModel: providerId === 'ollama' ? ollamaModel || undefined : undefined
        }
      })

      if (response.ok) {
        setSuggestions(response.result.suggestions)
        setWarnings(response.result.warnings)
        setDebugInfo(response.result.debug ?? null)
        setLlmStatus('Suggestions ready')
        return response.result.suggestions
      }

      setSuggestions([])
      setWarnings([])
      setDebugInfo(null)
      setLlmStatus('Suggestion error')
      setLlmError(response.error.message)
      return null
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : 'Unknown error')
      setDebugInfo(null)
      setLlmStatus('Suggestion error')
      return null
    } finally {
      setIsGenerating(false)
    }
  }

  const runUserFlow = async () => {
    setIsGenerating(true)
    setLlmStatus('Extracting form fields...')
    setLlmError(null)

    try {
      const tab = await getActiveTab()
      if (!tab?.id) {
        setLlmStatus('No active tab')
        return
      }

      let extractionResult: ExtractionResult
      try {
        const resp = await sendTabMessage<ExtractionResult | { error?: string }>(tab.id, {
          type: 'EXTRACT_FIELDS'
        })

        if (resp && 'error' in resp && resp.error) {
          setLlmStatus(`Error: ${resp.error}`)
          return
        }

        extractionResult = resp as ExtractionResult
      } catch (error) {
        setLlmStatus('No content script - reload the page')
        return
      }

      if (!extractionResult.fields.length) {
        setLlmStatus('No fields found on the page')
        return
      }

      const fields = mapExtractionToMetadata(extractionResult.fields)
      const suggestionsResult = await generateSuggestions(fields, {
        title: extractionResult.title,
        url: extractionResult.url,
        inputs: extractionResult.fields.filter((field) => field.tag === 'input').length,
        textareas: extractionResult.fields.filter((field) => field.tag === 'textarea').length,
        selects: extractionResult.fields.filter((field) => field.tag === 'select').length
      })

      if (!suggestionsResult) {
        return
      }

      try {
        await sendTabMessage(tab.id, {
          type: 'SHOW_SUGGESTIONS_OVERLAY',
          suggestions: suggestionsResult,
          minConfidence: confidenceThreshold
        })
        setLlmStatus('Suggestions sent to page overlay')
        window.setTimeout(() => window.close(), 120)
      } catch (error) {
        setLlmStatus('Failed to show overlay on page')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const runDevLlm = async () => {
    if (!extraction?.fields?.length) {
      setExtractionStatus('Extract fields first')
      return
    }

    const fields = mapExtractionToMetadata(extraction.fields)
    await generateSuggestions(fields, {
      title: extraction.title,
      url: extraction.url,
      inputs: extraction.fields.filter((field) => field.tag === 'input').length,
      textareas: extraction.fields.filter((field) => field.tag === 'textarea').length,
      selects: extraction.fields.filter((field) => field.tag === 'select').length
    })
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
              {'<-'}
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
                    {item.approved ? 'yes' : ''}
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

  const providerStatus = providerStatuses?.[providerId]
  const providerStatusLabel = providerStatus?.available ? 'Connected' : 'Unconnected'
  const providerStatusClass = providerStatus?.available
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-slate-200 bg-slate-100 text-slate-600'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 text-slate-900">
      <div className="w-[360px] px-4 py-3">
        <div className="fade-in flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Smart Form Filler</h1>
            <p className="text-xs text-slate-600">Local knowledge, human-reviewed suggestions</p>
          </div>
          <button
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600"
            onClick={openSetupAssistant}
          >
            Settings
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 rounded-xl border border-slate-200/70 bg-white/80 p-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
          <button
            className={`rounded-lg px-2 py-2 transition ${
              activeTab === 'main'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
            onClick={() => setActiveTab('main')}
          >
            Main
          </button>
          <button
            className={`rounded-lg px-2 py-2 transition ${
              activeTab === 'dev'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
            onClick={() => setActiveTab('dev')}
          >
            Dev
          </button>
        </div>

        {activeTab === 'main' ? (
          <div className="mt-3 grid gap-3">
            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Provider
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-slate-900">{providerStatus?.label ?? 'Provider'}</div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${providerStatusClass}`}>
                  {providerStatusLabel}
                </span>
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
                {providerStatus?.details && (
                  <div className="mt-1 text-[11px] text-slate-500">{providerStatus.details}</div>
                )}
                {providerId === 'ollama' && (
                  <div className="mt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Model</div>
                    <select
                      aria-label="Select Ollama model"
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      value={ollamaModel}
                      onChange={(event) => setOllamaModel(event.target.value)}
                    >
                      {ollamaModels.length === 0 ? (
                        <option value="">No local models found</option>
                      ) : (
                        ollamaModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))
                      )}
                    </select>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {ollamaModel ? `Selected model: ${ollamaModel}` : 'Run ollama list to install models.'}
                    </div>
                  </div>
                )}
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

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Privacy level</div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Low</span>
                <span>High</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={1}
                value={privacyLevel}
                onChange={(event) => setPrivacyLevel(Number(event.target.value))}
                aria-label="Privacy level"
                className="mt-2 w-full accent-slate-900"
              />
              <div className="mt-2 text-[11px] text-slate-600">
                {privacySetting.label}: {privacySetting.hint}
              </div>
              {providerId === 'openai' && privacyLevel === 0 && (
                <div className="mt-2 text-[11px] text-amber-700">
                  Low privacy sends all available data to the cloud model. Review carefully.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Confidence filter</div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Low</span>
                <span>High</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={1}
                value={confidenceThreshold}
                onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
                aria-label="Minimum confidence"
                className="mt-2 w-full accent-slate-900"
              />
              <div className="mt-2 text-[11px] text-slate-600">
                Showing {confidenceSetting} and higher confidence suggestions.
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Profile</div>
              <div className="mt-2 flex gap-2">
                <select
                  aria-label="Select profile"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={activeProfileId}
                  onChange={(event) => setActiveProfileId(event.target.value)}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
                  onClick={openSetupAssistant}
                >
                  +
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Active profile: {activeProfile.name}
              </div>
              <div className="mt-3 grid gap-2">
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Add entry label (e.g. phone number)"
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
                <div className="text-[11px] text-slate-500">{knowledgeStatus}</div>
                {knowledgeError && <div className="text-[11px] text-rose-600">{knowledgeError}</div>}
              </div>
            </div>

            <button
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={runUserFlow}
              disabled={isGenerating || cloudDisabled}
            >
              Analyze and suggest
            </button>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
              <div className="mt-1 text-sm text-slate-900">{llmStatus}</div>
              {llmError && <div className="mt-1 text-[11px] text-rose-600">{llmError}</div>}
              {suggestions.length > 0 && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Suggestions ready: {suggestions.length}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Current page
              </div>
              <div className="mt-2 grid gap-2">
                <button
                  className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
                  onClick={extractFields}
                >
                  Extract form fields
                </button>
                <button
                  disabled={!extraction || extraction.fields.length === 0}
                  className="w-full rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/20 transition hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                  onClick={simulateLLMAndReview}
                >
                  Review and fill form
                </button>
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5"
                  onClick={analyze}
                >
                  Analyze current page
                </button>
                <button
                  disabled={!extraction || extraction.fields.length === 0 || isGenerating}
                  className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                  onClick={runDevLlm}
                >
                  Run LLM with debug output
                </button>
              </div>
              <div className="mt-3 text-[11px] text-slate-600">{extractionStatus}</div>
              {extraction && (
                <div className="mt-2 text-[11px] text-slate-500 break-all">
                  {extraction.title || 'Untitled'} · {extraction.url}
                </div>
              )}
              {analysis && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Inputs: {analysis.inputs}, Textareas: {analysis.textareas}, Selects: {analysis.selects}
                </div>
              )}
              {extraction && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Fields: {extraction.fields.length}, skipped: {extraction.skipped}
                </div>
              )}
              {fillResult && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Filled: {fillResult.filled}, skipped: {fillResult.skipped}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Field mapping
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Profile: {activeProfile.name} · Entries: {activeProfileEntries.length}
              </div>
              {extraction?.fields?.length ? (
                <div className="mt-2 space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {fieldMatches.map(({ field, matches }, index) => {
                    const label = field.label ?? field.name ?? field.id ?? field.placeholder ?? 'Unnamed field'
                    const meta = [field.name, field.id, field.type, field.tag]
                      .filter(Boolean)
                      .join(' · ')

                    return (
                      <div key={`${label}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="text-xs font-semibold text-slate-700">{label}</div>
                        {meta && <div className="text-[10px] text-slate-500">{meta}</div>}
                        {matches.length > 0 ? (
                          <div className="mt-2 space-y-1">
                            {matches.slice(0, 3).map(({ entry, score }) => (
                              <div key={entry.id} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-slate-700">{entry.label}</span>
                                  <span className="text-slate-400">score {score}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 break-words">
                                  {entry.value ?? entry.summary ?? 'No value'}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] text-amber-700">
                            No matching knowledge entries.
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-slate-500">No fields extracted yet.</div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Suggestion status
              </div>
              <div className="mt-1 text-sm text-slate-900">{llmStatus}</div>
              {llmError && <div className="mt-1 text-[11px] text-rose-600">{llmError}</div>}
              {warnings.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  {warnings.map((warning, index) => (
                    <div key={`${warning.code}-${index}`}>- {warning.message}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Suggestion confidence
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Low</span>
                <span>High</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={1}
                value={confidenceThreshold}
                onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
                aria-label="Minimum confidence"
                className="mt-2 w-full accent-slate-900"
              />
              <div className="mt-2 text-[11px] text-slate-600">
                Showing {confidenceSetting} and higher confidence suggestions.
              </div>
              {filteredSuggestions.length > 0 ? (
                <div className="mt-3 space-y-2 max-h-[240px] overflow-y-auto pr-1">
                  {filteredSuggestions.map((suggestion) => (
                    <div key={suggestion.fieldId} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>{suggestion.fieldLabel ?? suggestion.fieldName ?? suggestion.fieldId}</span>
                        <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 capitalize">
                          {suggestion.confidence} ({confidenceScore(suggestion.confidence).toFixed(2)})
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{suggestion.suggestedValue ?? 'No suggestion'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-slate-500">No suggestions at this confidence.</div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                LLM debug output
              </div>
              <div className="mt-2 text-[11px] text-slate-500">Raw model output</div>
              <pre className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-700 whitespace-pre-wrap">
                {debugInfo?.rawOutput ?? 'No raw output captured yet.'}
              </pre>
              <div className="mt-3 text-[11px] text-slate-500">Parsed response</div>
              <pre className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-700 whitespace-pre-wrap">
                {debugInfo?.parsedResponse
                  ? JSON.stringify(debugInfo.parsedResponse, null, 2)
                  : 'No parsed response yet.'}
              </pre>
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Knowledge base</div>
              <div className="mt-1 text-[11px] text-slate-600">
                Entries: {knowledgeBase?.entries?.length ?? 0}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={refreshKnowledgeBase}
                >
                  Refresh
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold"
                  onClick={clearDemoKnowledge}
                >
                  Clear storage
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
