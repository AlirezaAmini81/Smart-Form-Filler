import React, { useRef, useState } from 'react'
import type { SuggestionSensitivity } from '../features/suggestions/suggestionTypes'
import { createChromeProfileRepository } from '../features/suggestions/profileRepository'
import { extractTextFromPdf } from '../features/import/pdfTextExtractor'
import { parseCvText } from '../features/import/pdfCvParser'
import { saveReviewedProfile } from './setupProfileService'

// ── types ─────────────────────────────────────────────────────
type Field = {
  key: string
  label: string
  placeholder: string
  required: boolean
  type?: string
}

type Status = 'idle' | 'saving' | 'success' | 'error'

// a single custom entry the user adds manually
type CustomEntry = {
  id: string        // random id so React can track each row
  title: string
  content: string
  long: boolean     // false = single line input, true = textarea
  sensitivity: SuggestionSensitivity
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

// ── fixed fields are grouped below for the UI and combined for storage. ──

// ── helper: make a blank custom entry ─────────────────────────
const blankEntry = (): CustomEntry => ({
  id:      Math.random().toString(36).slice(2),
  title:   '',
  content: '',
  long:    false,
  sensitivity: 'normal',
})

const createChatMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({
  id: Math.random().toString(36).slice(2),
  role,
  content
})

const parseChatInput = (text: string): CustomEntry[] => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let noteIndex = 1
  const entries: CustomEntry[] = []

  for (const line of lines) {
    const parts = line.split(':')
    if (parts.length > 1) {
      const title = parts[0].trim()
      const content = parts.slice(1).join(':').trim()
      if (!title || !content) {
        continue
      }
      entries.push({
        id: Math.random().toString(36).slice(2),
        title,
        content,
        long: content.length > 80,
        sensitivity: 'normal'
      })
    } else {
      const content = line.trim()
      if (!content) {
        continue
      }
      entries.push({
        id: Math.random().toString(36).slice(2),
        title: `Note ${noteIndex}`,
        content,
        long: content.length > 80,
        sensitivity: 'normal'
      })
      noteIndex += 1
    }
  }

  return entries
}

const STORAGE_SOURCE_ID = 'source_setup_assistant'
const STORAGE_SOURCE_LABEL = 'Setup Assistant'
const PDF_SOURCE_ID = 'source_pdf_document_import'

const BASIC_FIELDS: Field[] = [
  { key: 'name',                 label: 'Full name',          placeholder: 'Alice Smith',                    required: false },
  { key: 'professional-title',   label: 'Professional title', placeholder: 'Software Engineer',              required: false },
  { key: 'e-mail',               label: 'E-mail address',     placeholder: 'alice@example.com',              required: false, type: 'email' },
  { key: 'phone',                label: 'Phone number',       placeholder: '+49 123 456789',                 required: false }
]

const OPTIONAL_DETAIL_FIELDS: Field[] = [
  { key: 'location',   label: 'City / location', placeholder: 'Berlin, Germany', required: false },
  { key: 'street',     label: 'Street address',  placeholder: '123 Main St',    required: false },
  { key: 'postalcode', label: 'Postal code',     placeholder: '10115',          required: false },
  { key: 'age',        label: 'Age',             placeholder: '30',             required: false, type: 'number' }
]

const FIELDS: Field[] = [...BASIC_FIELDS, ...OPTIONAL_DETAIL_FIELDS]

const DEFAULT_FIELD_SENSITIVITY: Record<string, SuggestionSensitivity> = {
  'e-mail': 'sensitive',
  phone: 'sensitive',
  street: 'sensitive',
  postalcode: 'sensitive',
  location: 'sensitive',
  age: 'sensitive'
}

const SENSITIVITY_OPTIONS: SuggestionSensitivity[] = [
  'public',
  'normal',
  'sensitive',
  'secret'
]

const SENSITIVITY_LABELS: Record<SuggestionSensitivity, string> = {
  public: 'public',
  normal: 'normal',
  sensitive: 'privat',
  secret: 'secret'
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// ── component ─────────────────────────────────────────────────
export default function SetupAssistant() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [accountId, setAccountId] = useState('')
  const [values, setValues]       = useState<Record<string, string>>({})
  const [fieldSensitivity, setFieldSensitivity] = useState<Record<string, SuggestionSensitivity>>(() =>
    Object.fromEntries(
      FIELDS.map((field) => [field.key, DEFAULT_FIELD_SENSITIVITY[field.key] ?? 'normal'])
    )
  )
  const [entries, setEntries]     = useState<CustomEntry[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLog, setChatLog]     = useState<ChatMessage[]>([])
  const [status, setStatus]       = useState<Status>('idle')
  const [message, setMessage]     = useState('')
  const [saved, setSaved]         = useState<Record<string, unknown> | null>(null)
  const [pdfImporting, setPdfImporting] = useState(false)
  const [importSourceLabel, setImportSourceLabel] = useState(STORAGE_SOURCE_LABEL)
  const [importDetails, setImportDetails] = useState<string | null>(null)
  const [importWarnings, setImportWarnings] = useState<string[]>([])

  // update a fixed field
  const set = (key: string, val: string) =>
    setValues(prev => ({ ...prev, [key]: val }))

  const setSensitivity = (key: string, val: SuggestionSensitivity) =>
    setFieldSensitivity(prev => ({ ...prev, [key]: val }))

  // add a new blank custom entry row
  const addEntry = () =>
    setEntries(prev => [...prev, blankEntry()])

  // update one field on a specific custom entry
  const updateEntry = (id: string, field: keyof CustomEntry, val: string | boolean) =>
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: val } : e))

  // remove a custom entry row
  const removeEntry = (id: string) =>
    setEntries(prev => prev.filter(e => e.id !== id))

  const handleChatSend = () => {
    const text = chatInput.trim()
    if (!text) {
      setMessage('Enter some information to add.')
      return
    }

    const parsed = parseChatInput(text)
    if (parsed.length === 0) {
      setMessage('No entries recognized. Use "Label: value" per line.')
      return
    }

    setEntries(prev => [...prev, ...parsed])
    setChatLog(prev => [
      ...prev,
      createChatMessage('user', text),
      createChatMessage('assistant', `Added ${parsed.length} entr${parsed.length === 1 ? 'y' : 'ies'}.`)
    ])
    setChatInput('')
    setStatus('idle')
    setMessage('')
  }

  const handlePdfSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setPdfImporting(true)
    setStatus('idle')
    setMessage('')
    setImportWarnings([])

    try {
      const extracted = await extractTextFromPdf(file)
      const parsed = parseCvText(extracted.text)
      const importedEntries: CustomEntry[] = parsed.entries.map((entry) => ({
        id: Math.random().toString(36).slice(2),
        title: entry.title,
        content: entry.content,
        long: entry.long,
        sensitivity: entry.sensitivity
      }))

      setValues((previous) => ({ ...previous, ...parsed.values }))
      setEntries(importedEntries)
      setImportWarnings(parsed.warnings)
      setImportSourceLabel(`Imported from ${extracted.fileName}`)
      setImportDetails(
        `${extracted.fileName}: ${extracted.processedPages} of ${extracted.pageCount} page${extracted.pageCount === 1 ? '' : 's'} read locally.`
      )

      if (!accountId.trim() && parsed.profileName) {
        setAccountId(slugify(parsed.profileName))
      }

      const truncationWarning = extracted.truncated
        ? 'Only the first part of this PDF was read. Review the imported information carefully.'
        : null

      setMessage(
        `Document imported. Review the detected information, edit anything needed, then save it to your knowledge base.${truncationWarning ? ` ${truncationWarning}` : ''}`
      )
    } catch (error) {
      setImportDetails(null)
      setImportWarnings([])
      setMessage(error instanceof Error ? error.message : 'The PDF document could not be imported.')
      setStatus('error')
    } finally {
      setPdfImporting(false)
    }
  }

  // A profile needs an ID and at least one useful value. All individual fields are optional.
  const validate = (): string | null => {
    if (!accountId.trim()) return 'Account ID is required'

    const hasFixedValue = Object.values(values).some((value) => value.trim())
    const hasCustomValue = entries.some((entry) => entry.title.trim() && entry.content.trim())
    if (!hasFixedValue && !hasCustomValue) {
      return 'Add information manually or import a document before saving.'
    }

    for (const entry of entries) {
      const hasTitle = Boolean(entry.title.trim())
      const hasContent = Boolean(entry.content.trim())
      if (hasTitle !== hasContent) {
        return 'Each additional entry needs both a title and a value.'
      }
    }

    return null
  }

  const handleSave = async () => {
    const err = validate()
    if (err) { setMessage(err); return }

    setStatus('saving')
    setMessage('')

    const id = accountId.trim().toLowerCase().replace(/\s+/g, '_')

    // flatten custom entries as key-value pairs: "Passport number": "AB123456"
    const customFlat = Object.fromEntries(
      entries
        .filter(e => e.title.trim())
        .map(e => [e.title.trim(), e.content])
    )

    const profileName = values.name?.trim() || accountId.trim()

    const payload = {
      accountId: id,
      profileName,
      ...values,
      ...customFlat,
      importedFrom: importSourceLabel,
      savedAt: new Date().toISOString(),
    }

    try {
      const repository = createChromeProfileRepository()
      if (!repository) throw new Error('chrome.storage.local is not available.')

      await saveReviewedProfile(repository, {
        confirmed: true,
        profileId: id,
        profileName,
        values,
        entries: entries.flatMap(({ title, content, long, sensitivity }) =>
          title.trim() && content.trim() ? [{ title, content, long, sensitivity }] : []
        ),
        fieldSensitivity,
        sourceId: importSourceLabel === STORAGE_SOURCE_LABEL ? STORAGE_SOURCE_ID : PDF_SOURCE_ID,
        sourceLabel: importSourceLabel
      })

      setSaved(payload)
      setStatus('success')
      setMessage(`Profile "${profileName}" saved to the knowledge base.`)

    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'Something went wrong. Try again.')
    }
  }

  const handleReset = () => {
    setAccountId('')
    setValues({})
    setFieldSensitivity(
      Object.fromEntries(
        FIELDS.map((field) => [field.key, DEFAULT_FIELD_SENSITIVITY[field.key] ?? 'normal'])
      )
    )
    setEntries([])
    setChatInput('')
    setChatLog([])
    setImportSourceLabel(STORAGE_SOURCE_LABEL)
    setImportDetails(null)
    setImportWarnings([])
    setStatus('idle')
    setMessage('')
    setSaved(null)
  }


  const renderField = (field: Field) => (
    <div key={field.key}>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {field.label}
        {!field.required && <span className="ml-1 text-slate-400 font-normal">(optional)</span>}
      </label>
      <input
        type={field.type || 'text'}
        value={values[field.key] || ''}
        onChange={event => set(field.key, event.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Privacy</span>
        <select
          value={fieldSensitivity[field.key] ?? 'normal'}
          onChange={(event) =>
            setSensitivity(field.key, event.target.value as SuggestionSensitivity)
          }
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
          aria-label={`${field.label} privacy`}
        >
          {SENSITIVITY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {SENSITIVITY_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )

  // ── success screen ─────────────────────────────────────────
  if (status === 'success' && saved) {
    const data = saved as Record<string, unknown>
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-emerald-200 bg-white/90 p-8 shadow-lg backdrop-blur">

            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-xl">✓</div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Profile saved</h2>
                <p className="text-xs text-slate-500">Stored in the local knowledge base</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Stored data</div>
              <div className="space-y-2">
                {Object.entries(data)
                  .filter(([k]) => !['accountId', 'profileName', 'savedAt'].includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 text-sm">
                      <span className="text-slate-500 capitalize shrink-0">{k}</span>
                      <span className="text-slate-900 font-medium text-right whitespace-pre-wrap break-words">{String(v)}</span>
                    </div>
                  ))}
              </div>
            </div>

            {typeof data.savedAt === 'string' && (
              <div className="text-[11px] text-slate-400 mb-4">
                Saved at: {new Date(data.savedAt).toLocaleString()}
              </div>
            )}

            <button
              onClick={handleReset}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5"
            >
              Add another profile
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── main form screen ───────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-cyan-50 to-emerald-50 px-4 py-10">
      <div className="w-full max-w-md mx-auto">

        {/* header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Setup Assistant</h1>
              <p className="text-xs text-slate-500 mt-0.5">Smart Form Filler · Privacy-first local form assistance</p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
              Local-only
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-white/85 p-6 shadow-sm backdrop-blur space-y-5">

          {/* document PDF import */}
          <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-800">Import document from PDF</div>
                <p className="mt-1 text-[12px] leading-5 text-slate-600">
                  Select a text-based PDF document. The original PDF is not uploaded or stored.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pdfImporting}
                className="shrink-0 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pdfImporting ? 'Reading PDF...' : 'Choose PDF'}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handlePdfSelection}
              className="hidden"
            />

            {importDetails && (
              <p className="mt-3 rounded-lg border border-cyan-100 bg-white px-3 py-2 text-[11px] text-cyan-900">
                {importDetails}
              </p>
            )}

            {importWarnings.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-7 py-2 text-[11px] text-amber-800">
                {importWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </div>

          {/* account ID */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Account ID</div>
            <input
              type="text"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              placeholder="e.g. alice or john_doe"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Storage key: <code className="font-mono">{accountId || 'alice'}</code>
            </p>
          </div>

          <div className="border-t border-slate-100" />

          {/* main profile fields */}
          <div>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Basic profile</div>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">
                  Imported document data appears here first. You can leave any field empty and fill it manually later.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {BASIC_FIELDS.map(renderField)}
            </div>
          </div>

          <details className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-widest text-slate-500">
              Optional address and extra details
            </summary>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              These fields are not required.
            </p>
            <div className="mt-4 space-y-3">
              {OPTIONAL_DETAIL_FIELDS.map(renderField)}
            </div>
          </details>

          <div className="border-t border-slate-100" />

          {/* custom entries section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Additional information</div>
              <button
                onClick={addEntry}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-cyan-300 hover:text-cyan-700"
              >
                <span className="text-base leading-none">+</span> Add entry
              </button>
            </div>

            {entries.length === 0 && (
              <p className="text-[12px] text-slate-400 text-center py-3 rounded-xl border border-dashed border-slate-200">
                No custom entries yet. Click "+ Add entry" to add one.
              </p>
            )}

            <div className="space-y-4">
              {entries.map(entry => (
                <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">

                  {/* title + remove button */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.title}
                      onChange={e => updateEntry(entry.id, 'title', e.target.value)}
                      placeholder="Title  (e.g. Skills, Education, Availability)"
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                    />
                    <button
                      onClick={() => removeEntry(entry.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-500 transition text-lg leading-none"
                      title="Remove this entry"
                    >
                      ×
                    </button>
                  </div>

                  {/* short / long toggle */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateEntry(entry.id, 'long', false)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition ${
                        !entry.long
                          ? 'border-cyan-400 bg-cyan-50 text-cyan-700'
                          : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      Short value
                    </button>
                    <button
                      onClick={() => updateEntry(entry.id, 'long', true)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition ${
                        entry.long
                          ? 'border-cyan-400 bg-cyan-50 text-cyan-700'
                          : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      Long note
                    </button>
                  </div>

                  {/* content input — single line or textarea */}
                  {entry.long ? (
                    <textarea
                      value={entry.content}
                      onChange={e => updateEntry(entry.id, 'content', e.target.value)}
                      placeholder="Write your note here..."
                      rows={4}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 resize-y"
                    />
                  ) : (
                    <input
                      type="text"
                      value={entry.content}
                      onChange={e => updateEntry(entry.id, 'content', e.target.value)}
                      placeholder="Value  (e.g. React, Python, remote-friendly)"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Privacy</span>
                    <select
                      value={entry.sensitivity}
                      onChange={(event) =>
                        updateEntry(entry.id, 'sensitivity', event.target.value as SuggestionSensitivity)
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
                      aria-label="Entry privacy"
                    >
                      {SENSITIVITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {SENSITIVITY_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
              Quick import (chat)
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="max-h-32 overflow-y-auto space-y-2">
                {chatLog.length === 0 && (
                  <div className="text-[12px] text-slate-400">No messages yet.</div>
                )}
                {chatLog.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg px-3 py-2 text-[12px] ${
                      item.role === 'user'
                        ? 'bg-white border border-slate-200 text-slate-700'
                        : 'bg-emerald-50 border border-emerald-100 text-emerald-800'
                    }`}
                  >
                    {item.content}
                  </div>
                ))}
              </div>
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Paste info like: Email: alice@example.com\nPhone: +49 123 456789\nNote: Available after 5pm"
                rows={4}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 resize-y"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={handleChatSend}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                >
                  Add to entries
                </button>
                <span className="text-[11px] text-slate-400">PDF document import is available above.</span>
              </div>
            </div>
          </div>

          {/* validation / error message */}
          {message && status !== 'success' && (
            <div className={`rounded-xl px-3 py-2.5 text-sm ${
              status === 'error'
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              {message}
            </div>
          )}

          {/* save button */}
          <button
            onClick={handleSave}
            disabled={status === 'saving'}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {status === 'saving' ? 'Saving...' : 'Save to Knowledge Base'}
          </button>

        </div>
      </div>
    </div>
  )
}
