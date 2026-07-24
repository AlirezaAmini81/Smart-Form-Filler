import React, { useEffect, useMemo, useRef, useState } from 'react'
import { parseCvText } from '../features/import/pdfCvParser'
import { DOCUMENT_FILE_ACCEPT } from '../features/import/documentFileValidation'
import { extractTextFromDocument } from '../features/import/documentTextExtractor'
import type { KnowledgeEntry, StoredKnowledgeBase } from '../features/suggestions/knowledgeTypes'
import { createChromeProfileRepository } from '../features/suggestions/profileRepository'
import type { VaultStatus } from '../features/suggestions/profileVault'
import { PROVIDER_CATALOG, PROVIDER_IDS, providerOriginPattern, type ProviderId } from '../lib/llm/providerCatalog'
import type { BackgroundRequest, CredentialMutationResponse, CredentialStatusResponse, ProviderStatusResponse } from '../lib/messaging/types'
import {
  confirmDocumentImport,
  parsedCvToCandidates,
  type ImportCandidate
} from '../features/settings/documentImportService'
import { ProfileManagementService } from '../features/settings/profileManagementService'
import {
  createChromeSettingsRepository,
  type SettingsRepository
} from '../features/settings/settingsRepository'
import {
  createDefaultExtensionSettings,
  type ExtensionSettings,
  type SettingsSection
} from '../features/settings/settingsTypes'
import {
  adjacentSection,
  sectionFromHash,
  SETTINGS_SECTIONS
} from '../features/settings/settingsNavigation'

type LoadState = 'loading' | 'ready' | 'locked' | 'error'
type EntryDraft = Pick<KnowledgeEntry, 'label' | 'value' | 'aliases' | 'tags' | 'sensitivity' | 'sourceId' | 'sourceLabel'> & { id?: string }

const EMPTY_ENTRY: EntryDraft = {
  label: '',
  value: '',
  aliases: [],
  tags: [],
  sensitivity: 'normal',
  sourceId: 'source_manual',
  sourceLabel: 'Manual entry'
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The operation failed.'
  if (/locked/i.test(message)) return 'The encrypted vault is locked.'
  if (/unlock/i.test(message)) return 'The password was not accepted.'
  return message
}

function sendRuntimeMessage<T>(message: BackgroundRequest): Promise<T> {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => {
    const error = chrome.runtime.lastError
    if (error) reject(new Error(error.message))
    else resolve(response as T)
  }))
}

async function requestProviderPermission(providerId: ProviderId, endpoint?: string): Promise<void> {
  const granted = await chrome.permissions.request({ origins: [providerOriginPattern(providerId, endpoint)] })
  if (!granted) throw new Error('Provider host permission was denied.')
}

function useSection(): [SettingsSection, (section: SettingsSection) => void] {
  const [section, setSection] = useState(() => sectionFromHash(window.location.hash))
  useEffect(() => {
    const update = () => setSection(sectionFromHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const navigate = (next: SettingsSection) => {
    if (window.location.hash === `#${next}`) setSection(next)
    else window.location.hash = next
  }
  return [section, navigate]
}

function Status({ message, error = false }: { message: string; error?: boolean }) {
  return <p role="status" aria-live="polite" className={`status ${error ? 'status-error' : ''}`}>{message}</p>
}

function Dialog(props: { title: string; children: React.ReactNode; onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog-panel">
        <h2 id="dialog-title">{props.title}</h2>
        <div className="dialog-content">{props.children}</div>
        <div className="button-row">
          <button ref={cancelRef} className="button secondary" onClick={props.onCancel}>Cancel</button>
          <button className="button danger" onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export default function SettingsApp() {
  const [section, navigate] = useSection()
  const repository = useMemo(() => createChromeProfileRepository(), [])
  const settingsRepository = useMemo(() => createChromeSettingsRepository(), [])
  const profiles = useMemo(() => repository ? new ProfileManagementService(repository) : null, [repository])
  const [settings, setSettings] = useState<ExtensionSettings>(createDefaultExtensionSettings)
  const [knowledge, setKnowledge] = useState<StoredKnowledgeBase | null>(null)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>('uninitialized')
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    if (!repository || !settingsRepository) {
      setLoadState('error')
      setError('Extension storage is unavailable.')
      return
    }
    setError('')
    try {
      const [nextSettings, status] = await Promise.all([
        settingsRepository.get(),
        repository.vault.getStatus()
      ])
      setSettings(nextSettings)
      setVaultStatus(status)
      if (status === 'locked' || status === 'corrupted') {
        setKnowledge(null)
        setLoadState('locked')
      } else {
        setKnowledge(await repository.get())
        setLoadState('ready')
      }
    } catch (caught) {
      setKnowledge(null)
      setLoadState('error')
      setError(readableError(caught))
    }
  }

  useEffect(() => { void refresh() }, [repository, settingsRepository])

  const saveSettings = async (next: ExtensionSettings, success?: string) => {
    if (!settingsRepository) return
    try {
      setError('')
      const saved = await settingsRepository.save(next)
      setSettings(saved)
      if (success) setMessage(success)
    } catch (caught) {
      setError(readableError(caught))
    }
  }

  const activeProfile = knowledge?.profiles.find((profile) => profile.id === settings.activeProfileId) ?? null
  const entryCount = activeProfile ? knowledge?.entries.filter((entry) => entry.profileId === activeProfile.id).length ?? 0 : 0
  const sourceCount = new Set(knowledge?.entries.map((entry) => entry.sourceId).filter((id) => id.startsWith('source_pdf_'))).size

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="brand"><span className="brand-mark">SF</span><div><strong>Smart Form Filler</strong><small>Settings</small></div></div>
        <nav aria-label="Settings sections" className="settings-nav">
          {SETTINGS_SECTIONS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={section === item.id ? 'page' : undefined}
              className={section === item.id ? 'active' : ''}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                event.preventDefault()
                const next = adjacentSection(item.id, event.key === 'ArrowDown' ? 1 : -1)
                navigate(next)
                document.querySelector<HTMLAnchorElement>(`a[href="#${next}"]`)?.focus()
              }}
            >{item.label}</a>
          ))}
        </nav>
        <div className="sidebar-status"><span className={`status-dot ${vaultStatus === 'unlocked' ? 'ok' : ''}`} />Vault: {vaultStatus}</div>
      </aside>

      <main className="settings-main">
        {loadState === 'loading' && <Status message="Loading settings…" />}
        {error && <Status message={error} error />}
        {message && <Status message={message} />}
        {section === 'overview' && <OverviewSection settings={settings} knowledge={knowledge} vaultStatus={vaultStatus} providerConnected={null} sourceCount={sourceCount} navigate={navigate} />}
        {section === 'setup' && settingsRepository && <SetupSection settings={settings} save={saveSettings} navigate={navigate} hasProfile={Boolean(knowledge?.profiles.length)} />}
        {section === 'profiles' && <ProfilesSection service={profiles} settings={settings} settingsRepository={settingsRepository} knowledge={knowledge} locked={loadState === 'locked'} refresh={refresh} />}
        {section === 'documents' && <DocumentsSection repository={repository} knowledge={knowledge} settings={settings} locked={loadState === 'locked'} refresh={refresh} />}
        {section === 'providers' && <ProvidersSection settings={settings} vaultStatus={vaultStatus} save={saveSettings} />}
        {section === 'encryption' && <EncryptionSection repository={repository} status={vaultStatus} knowledge={knowledge} refresh={refresh} />}
        {section === 'general' && <GeneralSection settings={settings} save={saveSettings} />}
      </main>
    </div>
  )
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return <header className="page-header"><h1>{title}</h1><p>{description}</p></header>
}

function OverviewSection(props: { settings: ExtensionSettings; knowledge: StoredKnowledgeBase | null; vaultStatus: VaultStatus; providerConnected: boolean | null; sourceCount: number; navigate: (s: SettingsSection) => void }) {
  const active = props.knowledge?.profiles.find((profile) => profile.id === props.settings.activeProfileId)
  return <section><PageHeader title="Overview" description="Your extension status without exposing profile values." />
    <div className="summary-grid">
      <article><span>Setup</span><strong>{props.settings.setup.completed ? 'Complete' : 'Incomplete'}</strong><button onClick={() => props.navigate('setup')}>{props.settings.setup.completed ? 'Review setup' : 'Continue setup'}</button></article>
      <article><span>Active profile</span><strong>{active?.name ?? 'None selected'}</strong><small>{props.knowledge?.profiles.length ?? 0} profiles</small><button onClick={() => props.navigate('profiles')}>Manage profiles</button></article>
      <article><span>Provider</span><strong>{PROVIDER_CATALOG[props.settings.provider.selectedProvider].name}</strong><small>{props.providerConnected === null ? 'Not tested this session' : props.providerConnected ? 'Connected' : 'Unavailable'}</small><button onClick={() => props.navigate('providers')}>Configure provider</button></article>
      <article><span>Vault</span><strong>{props.vaultStatus}</strong><small>Session keys are never persisted locally.</small><button onClick={() => props.navigate('encryption')}>{props.vaultStatus === 'locked' ? 'Unlock vault' : 'Manage encryption'}</button></article>
      <article><span>Documents</span><strong>{props.sourceCount} imported sources</strong><small>Original files are not stored.</small><button onClick={() => props.navigate('documents')}>Import document</button></article>
    </div>
    {!active && <div className="attention"><strong>Action required</strong><p>Create or select an active profile before analyzing forms.</p></div>}
  </section>
}

const SETUP_STEPS = [
  ['Welcome and privacy', 'Profile values stay local unless you explicitly enable and use OpenAI cloud mode.'],
  ['Choose a setup method', 'Create a profile manually or import a PDF, DOCX, or TXT document.'],
  ['Review your profile', 'Confirm imported or manually entered information before it is saved.'],
  ['Select a provider', 'Choose Ollama or a cloud provider using your own credentials.'],
  ['Verify the provider', 'Run a connection test without sending profile data.'],
  ['Encryption', 'Optionally migrate profile data into the encrypted vault.'],
  ['Finish', 'Complete setup after reviewing the configuration.']
] as const

function SetupSection(props: { settings: ExtensionSettings; save: (settings: ExtensionSettings, message?: string) => Promise<void>; navigate: (s: SettingsSection) => void; hasProfile: boolean }) {
  const step = props.settings.setup.step
  const [title, description] = SETUP_STEPS[step]
  const go = async (next: number) => await props.save({ ...props.settings, setup: { ...props.settings.setup, step: next } }, 'Setup progress saved.')
  return <section><PageHeader title="Setup" description="Progress is saved after each confirmed step and can be resumed later." />
    <ol className="stepper">{SETUP_STEPS.map(([label], index) => <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
    <div className="setup-stage"><p className="eyebrow">Step {step + 1} of {SETUP_STEPS.length}</p><h2>{title}</h2><p>{description}</p>
      {step === 1 && <div className="button-row"><button className="button secondary" onClick={() => props.navigate('profiles')}>Enter manually</button><button className="button secondary" onClick={() => props.navigate('documents')}>Import document</button></div>}
      {step === 2 && <p className={props.hasProfile ? 'success-text' : 'warning-text'}>{props.hasProfile ? 'At least one profile is stored.' : 'Create and review a profile before continuing.'}</p>}
      {step === 3 && <button className="button secondary" onClick={() => props.navigate('providers')}>Configure provider</button>}
      {step === 4 && <button className="button secondary" onClick={() => props.navigate('providers')}>Test connection</button>}
      {step === 5 && <button className="button secondary" onClick={() => props.navigate('encryption')}>Review encryption</button>}
      <div className="button-row setup-actions">
        <button className="button secondary" disabled={step === 0} onClick={() => void go(step - 1)}>Back</button>
        {step < 6 ? <button className="button primary" disabled={step === 2 && !props.hasProfile} onClick={() => void go(step + 1)}>Save and continue</button>
          : <button className="button primary" onClick={() => void props.save({ ...props.settings, setup: { completed: true, step: 6 } }, 'Setup completed.')}>Finish setup</button>}
      </div>
    </div>
  </section>
}

function ProfilesSection(props: { service: ProfileManagementService | null; settings: ExtensionSettings; settingsRepository: SettingsRepository | null; knowledge: StoredKnowledgeBase | null; locked: boolean; refresh: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(props.settings.activeProfileId)
  const [draft, setDraft] = useState<EntryDraft | null>(null)
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState('')
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null)
  const [localError, setLocalError] = useState('')
  useEffect(() => { if (!selectedId && props.knowledge?.profiles[0]) setSelectedId(props.knowledge.profiles[0].id) }, [props.knowledge, selectedId])
  const selected = props.knowledge?.profiles.find((profile) => profile.id === selectedId) ?? null
  const entries = props.knowledge?.entries.filter((entry) => entry.profileId === selectedId) ?? []
  useEffect(() => setRename(selected?.name ?? ''), [selected?.id, selected?.name])
  const run = async (action: () => Promise<void>) => { try { setLocalError(''); await action(); await props.refresh() } catch (caught) { setLocalError(readableError(caught)) } }
  if (props.locked) return <section><PageHeader title="Profiles" description="Manage independent sets of form-filling information." /><div className="locked-panel"><h2>Vault locked</h2><p>Profile names and values are hidden until the vault is unlocked.</p><a className="button primary" href="#encryption">Unlock vault</a></div></section>
  return <section><PageHeader title="Profiles" description="Create, edit, duplicate, and select the profile used for analysis." />
    {localError && <Status message={localError} error />}
    <div className="profile-layout"><div className="profile-list"><form onSubmit={(event) => { event.preventDefault(); void run(async () => { const profile = await props.service!.create(newName); setNewName(''); setSelectedId(profile.id); if (!props.settings.activeProfileId) await props.settingsRepository?.save({ ...props.settings, activeProfileId: profile.id }) }) }}><label htmlFor="new-profile">New profile</label><div className="inline"><input id="new-profile" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Profile name" required /><button className="button primary">Create</button></div></form>
      <div className="profile-items">{props.knowledge?.profiles.map((profile) => <button key={profile.id} className={selectedId === profile.id ? 'selected' : ''} onClick={() => { setSelectedId(profile.id); setDraft(null) }}><strong>{profile.name}</strong><small>{profile.id === props.settings.activeProfileId ? 'Active · ' : ''}{props.knowledge!.entries.filter((entry) => entry.profileId === profile.id).length} entries</small></button>)}</div></div>
      <div className="profile-editor">{!selected ? <div className="empty-state"><h2>No profile selected</h2><p>Create a profile to begin.</p></div> : <>
        <div className="editor-heading"><div><p className="eyebrow">{selected.id === props.settings.activeProfileId ? 'Active profile' : 'Profile'}</p><h2>{selected.name}</h2></div><div className="button-row"><button className="button secondary" onClick={() => void run(async () => { await props.settingsRepository?.save({ ...props.settings, activeProfileId: selected.id }); setDraft(null) })}>Make active</button><button className="button secondary" onClick={() => void run(async () => { const copy = await props.service!.duplicate(selected.id); setSelectedId(copy.id) })}>Duplicate</button><button className="button danger-outline" onClick={() => setDeleteProfileId(selected.id)}>Delete</button></div></div>
        <form className="rename-form" onSubmit={(event) => { event.preventDefault(); void run(async () => props.service!.rename(selected.id, rename)) }}><label htmlFor="profile-name">Profile name</label><div className="inline"><input id="profile-name" value={rename} onChange={(e) => setRename(e.target.value)} required /><button className="button secondary">Rename</button></div></form>
        <div className="entries-heading"><h3>Information</h3><button className="button primary" onClick={() => setDraft({ ...EMPTY_ENTRY, aliases: [], tags: [] })}>Add information</button></div>
        {entries.length === 0 ? <div className="empty-state"><p>No information saved in this profile.</p></div> : <div className="entry-list">{entries.map((entry) => <article key={entry.id}><div><strong>{entry.label}</strong><p>{entry.value ?? entry.summary ?? 'No value'}</p><small>{entry.sensitivity} · {entry.sourceLabel ?? entry.sourceId}</small></div><div className="button-row"><button className="text-button" onClick={() => setDraft({ ...entry, aliases: entry.aliases ?? [], tags: entry.tags ?? [] })}>Edit</button><button className="text-button danger-text" onClick={() => setDeleteEntryId(entry.id)}>Delete</button></div></article>)}</div>}
        {draft && <EntryEditor draft={draft} onCancel={() => setDraft(null)} onSave={(next) => void run(async () => { await props.service!.saveEntry(selected.id, { label: next.label, value: next.value || undefined, aliases: next.aliases?.length ? next.aliases : undefined, tags: next.tags?.length ? next.tags : undefined, sensitivity: next.sensitivity, sourceId: next.sourceId, sourceLabel: next.sourceLabel }, next.id); setDraft(null) })} />}
      </>}</div></div>
    {deleteEntryId && <Dialog title="Delete profile entry?" confirmLabel="Delete entry" onCancel={() => setDeleteEntryId(null)} onConfirm={() => void run(async () => { await props.service!.deleteEntry(selected!.id, deleteEntryId); setDeleteEntryId(null) })}><p>This removes the entry from future mapping. Other entries are preserved.</p></Dialog>}
    {deleteProfileId && <Dialog title={`Delete “${selected?.name}”?`} confirmLabel="Delete profile" onCancel={() => setDeleteProfileId(null)} onConfirm={() => void run(async () => { const remaining = props.knowledge!.profiles.filter((profile) => profile.id !== deleteProfileId); const nextActive = props.settings.activeProfileId === deleteProfileId ? remaining[0]?.id ?? null : props.settings.activeProfileId; await props.settingsRepository?.save({ ...props.settings, activeProfileId: nextActive }); await props.service!.deleteProfile(deleteProfileId); setSelectedId(nextActive); setDeleteProfileId(null) })}><p>All local entries owned by this profile will be removed. Provider configuration, extension settings, other profiles, and original source files are unaffected.</p></Dialog>}
  </section>
}

function EntryEditor(props: { draft: EntryDraft; onCancel: () => void; onSave: (draft: EntryDraft) => void }) {
  const [draft, setDraft] = useState(props.draft)
  return <form className="entry-editor" onSubmit={(event) => { event.preventDefault(); props.onSave(draft) }}><h3>{draft.id ? 'Edit information' : 'Add information'}</h3><div className="form-grid"><label>Label<input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} required /></label><label>Value<textarea value={draft.value ?? ''} onChange={(e) => setDraft({ ...draft, value: e.target.value })} required rows={3} /></label><label>Aliases<input value={draft.aliases?.join(', ') ?? ''} onChange={(e) => setDraft({ ...draft, aliases: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} placeholder="phone, telephone" /></label><label>Tags<input value={draft.tags?.join(', ') ?? ''} onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></label><label>Sensitivity<select value={draft.sensitivity} onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value as KnowledgeEntry['sensitivity'] })}><option value="public">Public</option><option value="normal">Normal</option><option value="sensitive">Sensitive</option><option value="secret">Secret</option></select></label><label>Source<input value={draft.sourceLabel ?? draft.sourceId} disabled /></label></div><div className="button-row"><button type="button" className="button secondary" onClick={props.onCancel}>Cancel</button><button className="button primary">Save</button></div></form>
}

function DocumentsSection(props: { repository: ReturnType<typeof createChromeProfileRepository>; knowledge: StoredKnowledgeBase | null; settings: ExtensionSettings; locked: boolean; refresh: () => Promise<void> }) {
  const [target, setTarget] = useState(props.settings.activeProfileId ?? '')
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [sourceLabel, setSourceLabel] = useState('')
  const [progress, setProgress] = useState('')
  const [localError, setLocalError] = useState('')
  if (props.locked) return <section><PageHeader title="Documents" description="Import reviewed information into a selected profile." /><div className="locked-panel"><h2>Unlock required</h2><p>Document candidates cannot be persisted while the vault is locked.</p><a className="button primary" href="#encryption">Unlock vault</a></div></section>
  const choose = async (file?: File) => {
    if (!file) return
    try {
      setLocalError('')
      setProgress('Reading document locally…')
      const extracted = await extractTextFromDocument(file)
      setProgress('Extracting candidate information…')
      const parsed = parseCvText(extracted.text)
      setCandidates(parsedCvToCandidates(parsed))
      setSourceLabel(`Imported from ${file.name}`)
      const readSummary = extracted.fileType === 'pdf'
        ? `${extracted.processedPages} page(s) read.`
        : `${extracted.fileType.toUpperCase()} text read.`
      const warningSummary = extracted.warnings.length
        ? ` ${extracted.warnings.length} document warning(s) were reported.`
        : ''
      setProgress(`${readSummary}${warningSummary} Review every candidate before confirming.`)
    } catch (caught) {
      setCandidates([])
      setProgress('')
      setLocalError(readableError(caught))
    }
  }
  const sources = [...new Set(props.knowledge?.entries
    .filter((entry) => entry.sourceId.startsWith('source_document_') || entry.sourceId.startsWith('source_pdf_'))
    .map((entry) => entry.sourceLabel ?? entry.sourceId) ?? [])]
  return <section><PageHeader title="Documents" description="PDF, DOCX, and TXT text is parsed locally. Nothing is saved until you confirm the reviewed candidates." />{localError && <Status message={localError} error />}
    <div className="document-upload"><label htmlFor="target-profile">Target profile</label><select id="target-profile" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select a profile</option>{props.knowledge?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><label className={`file-button ${!target ? 'disabled' : ''}`}>Choose document<input type="file" accept={DOCUMENT_FILE_ACCEPT} disabled={!target} onChange={(e) => { const input = e.currentTarget; void choose(input.files?.[0]); input.value = '' }} /></label><small>PDF, DOCX, or TXT, up to 8 MB. PDFs must contain selectable text; OCR is not available.</small></div>
    {progress && <Status message={progress} />}
    {candidates.length > 0 && <div className="candidate-review"><h2>Review candidates</h2>{candidates.map((candidate) => <article key={candidate.id}><label>Label<input value={candidate.label} onChange={(e) => setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, label: e.target.value } : item))} /></label><label>Value<textarea rows={2} value={candidate.value} onChange={(e) => setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, value: e.target.value } : item))} /></label><label>On conflict<select value={candidate.decision} onChange={(e) => setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, decision: e.target.value as ImportCandidate['decision'] } : item))}><option value="keep">Keep existing value</option><option value="replace">Replace existing value</option><option value="alternative">Add alternative entry</option></select></label><button className="text-button danger-text" onClick={() => setCandidates((items) => items.filter((item) => item.id !== candidate.id))}>Remove candidate</button></article>)}<div className="button-row"><button className="button secondary" onClick={() => { setCandidates([]); setProgress('Import cancelled. No profile data was changed.') }}>Cancel</button><button className="button primary" onClick={() => void (async () => { try { await confirmDocumentImport(props.repository!, { confirmed: true, profileId: target, sourceId: `source_document_${Date.now().toString(36)}`, sourceLabel, candidates }); setCandidates([]); setProgress('Import confirmed and profile updated.'); await props.refresh() } catch (caught) { setLocalError(readableError(caught)) } })()}>Confirm import</button></div></div>}
    <div className="source-list"><h2>Imported sources</h2>{sources.length ? <ul>{sources.map((source) => <li key={source}>{source}</li>)}</ul> : <p>No imported source records.</p>}<small>Original document bytes and extracted text are not stored.</small></div>
  </section>
}

function ProvidersSection(props: { settings: ExtensionSettings; vaultStatus: VaultStatus; save: (settings: ExtensionSettings, message?: string) => Promise<void> }) {
  const [draft, setDraft] = useState(props.settings.provider)
  const [testState, setTestState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [persistence, setPersistence] = useState<'persistent' | 'session'>(props.vaultStatus === 'unlocked' ? 'persistent' : 'session')
  const [credentialStatus, setCredentialStatus] = useState<{ configured: boolean; persistence: 'persistent' | 'session' | null; masked: string | null }>({ configured: false, persistence: null, masked: null })
  useEffect(() => setDraft(props.settings.provider), [props.settings.provider])
  const selected = draft.selectedProvider
  const isCloud = PROVIDER_CATALOG[selected].mode === 'cloud'
  const endpoint = selected === 'ollama' ? draft.providers.ollama.endpoint : undefined
  const refreshCredential = async () => {
    const response = await sendRuntimeMessage<CredentialStatusResponse>({ type: 'GET_PROVIDER_CREDENTIAL_STATUS', payload: { providerId: selected } })
    if (response.ok) setCredentialStatus(response.status)
  }
  useEffect(() => { setApiKey(''); setTestMessage(''); void refreshCredential() }, [selected])
  const save = async () => {
    try {
      await requestProviderPermission(selected, endpoint)
      await props.save({ ...props.settings, provider: draft }, 'Provider settings saved.')
      if (apiKey.trim()) {
        const response = await sendRuntimeMessage<CredentialMutationResponse>({ type: 'SAVE_PROVIDER_CREDENTIAL', payload: { providerId: selected, apiKey, persistence } })
        if (!response.ok) throw new Error(response.error.message)
        setApiKey('')
        await refreshCredential()
      }
    } catch (caught) { setTestState('error'); setTestMessage(readableError(caught)) }
  }
  const test = async () => {
    setTestState('loading'); setTestMessage('Testing connection…')
    try {
      await requestProviderPermission(selected, endpoint)
      await props.save({ ...props.settings, provider: draft })
      const response = await sendRuntimeMessage<ProviderStatusResponse>({ type: 'GET_LLM_PROVIDER_STATUS', payload: { providerId: selected } })
      if (!response.ok) throw new Error(response.error.message)
      setTestState(response.status.available ? 'success' : 'error')
      setTestMessage(response.status.details ?? (response.status.available ? 'Connected.' : 'Provider unavailable.'))
    } catch (caught) { setTestState('error'); setTestMessage(readableError(caught)) }
  }
  const removeCredential = async () => {
    const response = await sendRuntimeMessage<CredentialMutationResponse>({ type: 'DELETE_PROVIDER_CREDENTIAL', payload: { providerId: selected } })
    if (!response.ok) { setTestState('error'); setTestMessage(response.error.message); return }
    setApiKey(''); await refreshCredential(); setTestMessage('Credential deleted.')
  }
  const updateModel = (model: string) => setDraft({ ...draft, providers: { ...draft.providers, [selected]: { ...draft.providers[selected], model } } })
  const modelOptions = PROVIDER_CATALOG[selected].models
  const selectedModelIsCurated = modelOptions.some((option) => option.id === draft.providers[selected].model)
  return <section><PageHeader title="Providers" description="The extension contacts your selected provider directly. The application operator never receives your key or LLM request." /><div className="settings-form">
    <label>Provider<select value={selected} onChange={(e) => setDraft({ ...draft, selectedProvider: e.target.value as ProviderId })}>{PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDER_CATALOG[id].name}{id === 'ollama' ? ' (local)' : ''}</option>)}</select></label>
    {selected === 'ollama' && <label>Ollama endpoint<input type="url" value={draft.providers.ollama.endpoint} onChange={(e) => setDraft({ ...draft, providers: { ...draft.providers, ollama: { ...draft.providers.ollama, endpoint: e.target.value } } })} required /></label>}
    <label>Model<select value={selectedModelIsCurated ? draft.providers[selected].model : 'custom'} onChange={(e) => updateModel(e.target.value === 'custom' ? '' : e.target.value)}>{modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="custom">Custom model…</option></select></label>
    {!selectedModelIsCurated && <label>Custom model ID<input value={draft.providers[selected].model} onChange={(e) => updateModel(e.target.value)} placeholder="Enter provider model ID" required /></label>}
    <div className="vault-state"><span>Credential</span><strong>{credentialStatus.configured ? `${credentialStatus.masked} (${credentialStatus.persistence})` : selected === 'ollama' ? 'Not configured (optional)' : 'Not configured'}</strong></div>
    {(isCloud || credentialStatus.configured || selected === 'ollama') && <><label>API key{selected === 'ollama' ? ' (optional)' : ''}<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={credentialStatus.configured ? 'Enter a replacement key' : 'Enter API key'} /></label><label>Storage<select value={persistence} onChange={(e) => setPersistence(e.target.value as 'persistent' | 'session')}><option value="session">Session only</option><option value="persistent" disabled={props.vaultStatus !== 'unlocked'}>Encrypted persistent</option></select></label>{props.vaultStatus !== 'unlocked' && <small>Enable encryption to save this API key permanently. Session-only keys disappear after restart, reload, lock, or deletion.</small>}</>}
    <div className={`privacy-note ${isCloud ? 'warning' : ''}`}><strong>{isCloud ? 'Cloud provider' : 'Ollama endpoint'}</strong><p>{isCloud ? 'Selected profile facts required for mapping may be sent directly to this provider. Browser-held credentials can still be extracted by an attacker with extension-context access.' : 'Traffic goes directly to the configured local endpoint. Only localhost and loopback endpoints are accepted.'}</p></div>
    <div className="button-row"><button className="button secondary" disabled={testState === 'loading'} onClick={() => void test()}>{testState === 'loading' ? 'Testing…' : 'Test connection'}</button><button className="button primary" onClick={() => void save()}>{credentialStatus.configured && apiKey ? 'Replace credential' : 'Save provider'}</button>{credentialStatus.configured && <button className="button danger-outline" onClick={() => void removeCredential()}>Delete credential</button>}</div>
    {testMessage && <Status message={testMessage} error={testState === 'error'} />}
  </div></section>
}

function EncryptionSection(props: { repository: ReturnType<typeof createChromeProfileRepository>; status: VaultStatus; knowledge: StoredKnowledgeBase | null; refresh: () => Promise<void> }) {
  const [password, setPassword] = useState(''); const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [localMessage, setLocalMessage] = useState(''); const [localError, setLocalError] = useState('')
  const run = async (action: () => Promise<void>, success: string) => { try { setLocalError(''); await action(); setPassword(''); setCurrentPassword(''); setNewPassword(''); setLocalMessage(success); await props.refresh() } catch (caught) { setLocalError(readableError(caught)) } }
  return <section><PageHeader title="Encryption" description="Protect canonical profile data with the existing password-based encrypted vault." /><div className="vault-state"><span>Current state</span><strong>{props.status}</strong><p>An unlocked key is retained only in Chrome session storage. Restarting or reloading the extension locks the vault.</p></div>{localError && <Status message={localError} error />}{localMessage && <Status message={localMessage} />}
    {(props.status === 'migration-required' || props.status === 'uninitialized') && <form className="settings-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { if (props.status === 'migration-required') await props.repository!.vault.migrate(password); else await props.repository!.vault.initialize(password, props.knowledge ?? { version: 1, updatedAt: new Date().toISOString(), profiles: [], entries: [] }) }, 'Encrypted vault enabled and unlocked.') }}><h2>Enable encrypted vault</h2><label>Create password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="new-password" /></label><button className="button primary">Encrypt profile data</button></form>}
    {props.status === 'locked' && <form className="settings-form" onSubmit={(e) => { e.preventDefault(); void run(async () => props.repository!.vault.unlock(password), 'Vault unlocked for this browser session.') }}><h2>Unlock vault</h2><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label><button className="button primary">Unlock</button></form>}
    {props.status === 'unlocked' && <><button className="button secondary" onClick={() => void run(async () => props.repository!.vault.lock(), 'Vault locked.')}>Lock now</button><form className="settings-form" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      const prepare = await sendRuntimeMessage<CredentialMutationResponse>({ type: 'PREPARE_PROVIDER_CREDENTIAL_REKEY' })
      if (!prepare.ok) throw new Error(prepare.error.message)
      try {
        await props.repository!.vault.changePassword(currentPassword, newPassword)
      } finally {
        const complete = await sendRuntimeMessage<CredentialMutationResponse>({ type: 'COMPLETE_PROVIDER_CREDENTIAL_REKEY' })
        if (!complete.ok) throw new Error(complete.error.message)
      }
    }, 'Vault password changed.') }}><h2>Change password</h2><label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" /></label><label>New password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={10} required autoComplete="new-password" /></label><button className="button primary">Change password</button></form></>}
    {(props.status === 'corrupted' || props.status === 'migration-failed') && <div className="attention"><strong>Vault needs attention</strong><p>Automatic changes are disabled to preserve existing data. Review the stored data before retrying migration.</p></div>}
  </section>
}

function GeneralSection(props: { settings: ExtensionSettings; save: (settings: ExtensionSettings, message?: string) => Promise<void> }) {
  const [general, setGeneral] = useState(props.settings.general)
  return <section><PageHeader title="General settings" description="Preferences that directly affect suggestion generation and review." /><div className="settings-form"><label>Suggestion mode<select value={general.suggestionMode} onChange={(e) => setGeneral({ ...general, suggestionMode: e.target.value as ExtensionSettings['general']['suggestionMode'] })}><option value="full-context">Full context (LLM)</option><option value="identifier-only">Private mapping (LLM)</option><option value="deterministic-only">Direct matching only</option></select></label><label>Minimum confidence<select value={general.confidenceThreshold} onChange={(e) => setGeneral({ ...general, confidenceThreshold: Number(e.target.value) })}><option value={0}>Low and above</option><option value={1}>Medium and above</option><option value={2}>High only</option></select></label><p className="privacy-note">Field filling always requires explicit review and approval. These preferences do not bypass confirmation.</p><button className="button primary" onClick={() => void props.save({ ...props.settings, general }, 'General settings saved.')}>Save settings</button></div></section>
}
