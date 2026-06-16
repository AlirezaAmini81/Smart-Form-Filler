import React, { useState } from 'react'

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
}

// ── fixed fields ───────────────────────────────────────────────
const FIELDS: Field[] = [
  { key: 'name',       label: 'Full name',          placeholder: 'Alice Smith',            required: true  },
  { key: 'age',        label: 'Age',                placeholder: '30',                     required: true, type: 'number' },
  { key: 'email',      label: 'Email address',      placeholder: 'alice@example.com',      required: true, type: 'email'  },
  { key: 'phone',      label: 'Phone number',       placeholder: '+49 123 456789',         required: false },
  { key: 'address',    label: 'Home address',       placeholder: 'Mitte, Berlin, Germany', required: true  },
  { key: 'education',  label: 'Education level',    placeholder: 'MSc Computer Science',   required: true  },
  { key: 'occupation', label: 'Current occupation', placeholder: 'ML Engineer (optional)', required: false },
]

// ── helper: make a blank custom entry ─────────────────────────
const blankEntry = (): CustomEntry => ({
  id:      Math.random().toString(36).slice(2),
  title:   '',
  content: '',
  long:    false,
})

// ── component ─────────────────────────────────────────────────
export default function SetupAssistant() {
  const [accountId, setAccountId] = useState('')
  const [values, setValues]       = useState<Record<string, string>>({})
  const [entries, setEntries]     = useState<CustomEntry[]>([])
  const [status, setStatus]       = useState<Status>('idle')
  const [message, setMessage]     = useState('')
  const [saved, setSaved]         = useState<Record<string, unknown> | null>(null)

  // update a fixed field
  const set = (key: string, val: string) =>
    setValues(prev => ({ ...prev, [key]: val }))

  // add a new blank custom entry row
  const addEntry = () =>
    setEntries(prev => [...prev, blankEntry()])

  // update one field on a specific custom entry
  const updateEntry = (id: string, field: keyof CustomEntry, val: string | boolean) =>
    setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: val } : e))

  // remove a custom entry row
  const removeEntry = (id: string) =>
    setEntries(prev => prev.filter(e => e.id !== id))

  // validate required fixed fields before saving
  const validate = (): string | null => {
    if (!accountId.trim()) return 'Account ID is required'
    for (const f of FIELDS) {
      if (f.required && !values[f.key]?.trim()) return `${f.label} is required`
    }
    // if a custom row exists, its title must not be empty
    for (const e of entries) {
      if (!e.title.trim()) return 'Each custom entry needs a title'
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

    const payload = {
      accountId: id,
      ...values,
      ...customFlat,
      savedAt: new Date().toISOString(),
    }

    try {
      await chrome.storage.local.set({ [id]: payload })

      const result = await chrome.storage.local.get(id)
      const data   = result[id]
      if (!data) throw new Error('Save appeared to succeed but data not found')

      setSaved(data)
      setStatus('success')
      setMessage(`Account "${id}" saved successfully.`)

    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'Something went wrong. Try again.')
    }
  }

  const handleReset = () => {
    setAccountId('')
    setValues({})
    setEntries([])
    setStatus('idle')
    setMessage('')
    setSaved(null)
  }

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
                <p className="text-xs text-slate-500">Stored in Chrome's local storage</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Stored data</div>
              <div className="space-y-2">
                {Object.entries(data)
                  .filter(([k]) => !['accountId', 'savedAt'].includes(k))
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

          {/* fixed personal info fields */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Personal information</div>
            <div className="space-y-3">
              {FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {f.label}
                    {!f.required && <span className="ml-1 text-slate-400 font-normal">(optional)</span>}
                  </label>
                  <input
                    type={f.type || 'text'}
                    value={values[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                  />
                </div>
              ))}
            </div>
          </div>

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
                      placeholder="Title  (e.g. Passport number)"
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
                      placeholder="Value  (e.g. AB123456)"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                    />
                  )}
                </div>
              ))}
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