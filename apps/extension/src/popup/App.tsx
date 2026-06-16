import React, { useState } from 'react'
import type { ExtractionResult } from '../lib/dom/extractFormFields'
import type { FieldAnswer, FillResult } from '../lib/dom/fillFormFields'

type Analysis = {
  title: string; url: string
  inputs: number; textareas: number; selects: number
}

// what the popup shows the user before they approve filling
type ReviewItem = {
  answer:   FieldAnswer
  approved: boolean      // user can uncheck individual fields
}

type AppView = 'main' | 'review'

export default function App() {
  const [view,       setView]       = useState<AppView>('main')
  const [analysis,   setAnalysis]   = useState<Analysis | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [fillResult, setFillResult] = useState<FillResult | null>(null)
  const [status,     setStatus]     = useState<string>('Idle')

  const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    )
    return tabs[0] ?? null
  }

  // ── analyze page (count only) ──────────────────────────────
  const analyze = async () => {
    setStatus('Analyzing page...')
    setExtraction(null)
    setFillResult(null)
    const tab = await getActiveTab()
    if (!tab?.id) { setStatus('No active tab'); return }
    chrome.tabs.sendMessage(tab.id, { type: 'ANALYZE_PAGE' }, (resp) => {
      if (chrome.runtime.lastError) { setStatus('No content script — reload the page'); return }
      setAnalysis(resp as Analysis)
      setStatus('Page analyzed')
    })
  }

  // ── extract fields ─────────────────────────────────────────
  const extractFields = async () => {
    setStatus('Extracting form fields...')
    setAnalysis(null)
    setFillResult(null)
    const tab = await getActiveTab()
    if (!tab?.id) { setStatus('No active tab'); return }
    chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_FIELDS' }, (resp) => {
      if (chrome.runtime.lastError) { setStatus('No content script — reload the page'); return }
      if (resp?.error) { setStatus(`Error: ${resp.error}`); return }
      setExtraction(resp as ExtractionResult)
      setStatus(`Found ${resp.fields.length} field(s)`)
    })
  }

  // simulate LLM answers for testing
  // this function should be replaced with a real LLM call.
  // For now it takes the extracted fields and pretends the LLM
  // returned answers by reading from chrome.storage (the user's profile).
  const simulateLLMAndReview = async () => {
    if (!extraction || extraction.fields.length === 0) {
      setStatus('Extract fields first')
      return
    }

    setStatus('Loading profile answers...')

    // load all saved profiles from chrome.storage
    const stored = await new Promise<Record<string, unknown>>((resolve) =>
      chrome.storage.local.get(null, resolve)
    )

    // pick the first profile found (later: let user choose which profile)
    const profiles = Object.values(stored) as Record<string, string>[]
    const profile  = profiles[0]

    if (!profile) {
      setStatus('No profile saved — open Setup Assistant first')
      return
    }

    // build simulated LLM answers:
    // match each extracted field's label against keys in the profile
    const answers: FieldAnswer[] = extraction.fields
      .map(field => {
        const fieldLabelLower = (field.label || field.name || '').toLowerCase()

        // find a profile key that loosely matches the field label
        const matchedKey = Object.keys(profile).find(key => {
          const keyLower = key.toLowerCase()
          return fieldLabelLower.includes(keyLower) ||
                 keyLower.includes(fieldLabelLower) ||
                 fieldLabelLower.split(' ').some(word => word.length > 2 && keyLower.includes(word))
        })

        if (!matchedKey) return null

        return {
          id:    field.id   || undefined,
          name:  field.name || undefined,
          label: field.label,
          value: String(profile[matchedKey]),
        } as FieldAnswer
      })
      .filter((a): a is FieldAnswer => a !== null)

    if (answers.length === 0) {
      setStatus('No profile fields matched the form — check your profile')
      return
    }

    // show review screen
    setReviewItems(answers.map(a => ({ answer: a, approved: true })))
    setView('review')
    setStatus(`${answers.length} field(s) ready to fill — review and approve`)
  }

  // ── toggle one field's approval ────────────────────────────
  const toggleApproval = (index: number) => {
    setReviewItems(prev => prev.map((item, i) =>
      i === index ? { ...item, approved: !item.approved } : item
    ))
  }

  // ── confirm and fill ───────────────────────────────────────
  const confirmFill = async () => {
    const approvedAnswers = reviewItems
      .filter(item => item.approved)
      .map(item => item.answer)

    if (approvedAnswers.length === 0) {
      setStatus('No fields approved — tick at least one')
      return
    }

    setStatus('Filling form...')
    const tab = await getActiveTab()
    if (!tab?.id) { setStatus('No active tab'); return }

    chrome.tabs.sendMessage(
      tab.id,
      { type: 'FILL_FIELDS', answers: approvedAnswers },
      (resp) => {
        if (chrome.runtime.lastError) { setStatus('No content script — reload the page'); return }
        if (resp?.error) { setStatus(`Error: ${resp.error}`); return }
        setFillResult(resp as FillResult)
        setView('main')
        setStatus(`Filled ${resp.filled} field(s), skipped ${resp.skipped}`)
      }
    )
  }

  // ── review screen ──────────────────────────────────────────
  if (view === 'review') {
    const approvedCount = reviewItems.filter(i => i.approved).length
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 text-slate-900">
        <div className="w-[360px] px-4 py-3">

          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setView('main')}
              className="text-slate-400 hover:text-slate-700 text-lg leading-none"
            >←</button>
            <h2 className="text-base font-semibold">Review before filling</h2>
          </div>

          <p className="text-[12px] text-slate-500 mb-3">
            Uncheck any field you don't want to fill. Then click Confirm.
          </p>

          <div className="space-y-2 mb-4 max-h-[340px] overflow-y-auto pr-1">
            {reviewItems.map((item, i) => (
              <div
                key={i}
                onClick={() => toggleApproval(i)}
                className={`rounded-xl border p-3 cursor-pointer transition ${
                  item.approved
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-slate-200 bg-white/60 opacity-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border text-[10px] font-bold transition ${
                    item.approved
                      ? 'border-emerald-400 bg-emerald-400 text-white'
                      : 'border-slate-300 bg-white'
                  }`}>
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
            Confirm — fill {approvedCount} field{approvedCount !== 1 ? 's' : ''}
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

  // ── main screen ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 text-slate-900">
      <div className="w-[360px] px-4 py-3">

        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Smart Form Filler</h1>
            <p className="text-xs text-slate-600">Privacy-first local form assistance</p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
            Local-only
          </span>
        </div>

        {/* status cards */}
        <div className="mt-3 grid gap-2">
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active profile</div>
            <div className="mt-1 text-sm font-medium text-slate-900">No profile selected</div>
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm backdrop-blur">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Local LLM</div>
            <div className="mt-1 text-sm font-medium text-slate-900">Not connected</div>
          </div>
        </div>

        {/* buttons */}
        <div className="mt-3 grid gap-2">

          {/* step 1 */}
          <button
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
            onClick={extractFields}
          >
            1 · Extract form fields
          </button>

          {/* step 2 — only active after extraction */}
          <button
            disabled={!extraction || extraction.fields.length === 0}
            className="w-full rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/20 transition hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            onClick={simulateLLMAndReview}
          >
            2 · Review &amp; fill form
          </button>

          <button
            className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5"
            onClick={analyze}
          >
            Analyze current page
          </button>
          <button
            className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') })}
          >
            Open Setup Assistant
          </button>
          <p className="text-[11px] leading-relaxed text-slate-500">
            No data leaves your device in local mode.
          </p>
        </div>

        {/* status bar */}
        <div className="mt-3 rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</div>
          <div className="mt-1 text-sm text-slate-900">{status}</div>
        </div>

        {/* fill result */}
        {fillResult && (
          <div className="mt-2 rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Fill result</div>
            <div className="flex gap-2 mb-2">
              <span className="rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold px-2 py-0.5">
                {fillResult.filled} filled
              </span>
              {fillResult.skipped > 0 && (
                <span className="rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold px-2 py-0.5">
                  {fillResult.skipped} skipped
                </span>
              )}
            </div>
            {fillResult.results.filter(r => !r.success).map((r, i) => (
              <div key={i} className="text-[11px] text-amber-700 mt-1">
                ⚠ {r.answer.label || r.answer.name}: {r.reason}
              </div>
            ))}
          </div>
        )}

        {/* extracted fields */}
        {extraction && (
          <div className="mt-2 rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Extracted fields</div>
              <div className="flex gap-1">
                <span className="rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold px-2 py-0.5">
                  {extraction.fields.length} kept
                </span>
                {extraction.skipped > 0 && (
                  <span className="rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold px-2 py-0.5">
                    {extraction.skipped} filtered
                  </span>
                )}
              </div>
            </div>
            <pre className="text-[10px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed max-h-48">
              {JSON.stringify(extraction, null, 2)}
            </pre>
          </div>
        )}

        {/* page analysis */}
        {analysis && (
          <div className="mt-2 rounded-xl border border-slate-200/70 bg-white/85 p-3 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Page analysis</div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="font-semibold">{analysis.title}</div>
              <div className="grid grid-cols-3 gap-2 text-xs mt-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                  Inputs<div className="text-sm font-semibold">{analysis.inputs}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                  Textareas<div className="text-sm font-semibold">{analysis.textareas}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
                  Selects<div className="text-sm font-semibold">{analysis.selects}</div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}