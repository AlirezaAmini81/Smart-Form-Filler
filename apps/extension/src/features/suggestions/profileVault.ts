import { z } from 'zod'
import { StoredProfileDataSchema, type StoredKnowledgeBase } from './knowledgeTypes'
import type { StorageAdapter } from './profileRepository'
import {
  createVaultSalt,
  DEFAULT_PBKDF2_ITERATIONS,
  decryptProfile,
  deriveKeyForEnvelope,
  deriveVaultKey,
  encryptProfile,
  exportVaultKey,
  importVaultKey
} from './profileVaultCrypto'
import {
  EncryptedVaultEnvelopeSchema,
  SessionVaultKeySchema,
  type EncryptedVaultEnvelope
} from './profileVaultSchemas'

export const PROFILE_VAULT_STORAGE_KEY = 'saff.profileVault.v1'
export const PROFILE_VAULT_SESSION_KEY = 'saff.profileVault.session.v1'
export const PROFILE_VAULT_MIGRATION_STATE_KEY = 'saff.profileVault.migration.v1'
export const LEGACY_KNOWLEDGE_STORAGE_KEY = 'saff.knowledgeBase.v1'
export const CANONICAL_PROFILE_STORAGE_KEY = 'saff.profiles.v1'

export type VaultStatus =
  | 'uninitialized'
  | 'locked'
  | 'unlocked'
  | 'migration-required'
  | 'migration-failed'
  | 'corrupted'

export type VaultErrorCode =
  | 'INVALID_PASSWORD_OR_DATA'
  | 'LOCKED'
  | 'CORRUPTED'
  | 'UNSUPPORTED_VERSION'
  | 'STORAGE_WRITE_FAILED'
  | 'MIGRATION_FAILED'
  | 'INVALID_STATE'

export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VaultError'
  }
}

export class VaultAuthenticationError extends VaultError {
  constructor(cause?: unknown) {
    super('INVALID_PASSWORD_OR_DATA', 'Unable to unlock vault.', { cause })
  }
}

export class VaultLockedError extends VaultError {
  constructor() {
    super('LOCKED', 'Vault is locked.')
  }
}

export interface ProfileVault {
  getStatus(): Promise<VaultStatus>
  initialize(password: string, profile: StoredKnowledgeBase): Promise<void>
  migrate(password: string): Promise<void>
  unlock(password: string): Promise<void>
  lock(): Promise<void>
  isUnlocked(): Promise<boolean>
  readProfile(): Promise<StoredKnowledgeBase>
  writeProfile(profile: StoredKnowledgeBase): Promise<void>
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  clear(): Promise<void>
}

type PlaintextCandidate = { key: string; data: StoredKnowledgeBase }

const LegacyFlatProfileSchema = z.object({
  accountId: z.string().trim().min(1),
  profileName: z.string().trim().min(1).optional(),
  savedAt: z.string().datetime().optional()
}).passthrough()

const LEGACY_METADATA_FIELDS = new Set(['accountId', 'profileName', 'savedAt', 'importedFrom'])

function legacyFlatProfile(value: unknown): StoredKnowledgeBase | null {
  const parsed = LegacyFlatProfileSchema.safeParse(value)
  if (!parsed.success) return null
  const profileId = parsed.data.accountId
  const entries = Object.entries(parsed.data)
    .filter(([label, entryValue]) => !LEGACY_METADATA_FIELDS.has(label) && typeof entryValue === 'string' && entryValue.trim())
    .map(([label, entryValue], index) => ({
      id: `legacy_${profileId}_${index}`,
      profileId,
      label,
      value: entryValue as string,
      sourceId: 'source_legacy_profile',
      sensitivity: 'sensitive' as const
    }))
  return StoredProfileDataSchema.parse({
    version: 1,
    updatedAt: parsed.data.savedAt ?? new Date(0).toISOString(),
    profiles: [{ id: profileId, name: parsed.data.profileName ?? profileId, sensitivity: 'normal' }],
    entries
  })
}

function sameProfile(left: StoredKnowledgeBase, right: StoredKnowledgeBase): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergePlaintextCandidates(candidates: PlaintextCandidate[]): StoredKnowledgeBase {
  const profiles = new Map<string, StoredKnowledgeBase['profiles'][number]>()
  const entries = new Map<string, StoredKnowledgeBase['entries'][number]>()
  for (const candidate of candidates) {
    for (const profile of candidate.data.profiles) {
      const existing = profiles.get(profile.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(profile)) {
        throw new VaultError('MIGRATION_FAILED', `Conflicting plaintext profile metadata for ${profile.id}.`)
      }
      profiles.set(profile.id, profile)
    }
    for (const entry of candidate.data.entries) {
      const existing = entries.get(entry.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) {
        throw new VaultError('MIGRATION_FAILED', `Conflicting plaintext knowledge entry ${entry.id}.`)
      }
      entries.set(entry.id, entry)
    }
  }
  const updatedAt = candidates.map(({ data }) => data.updatedAt).sort().at(-1)
  return StoredProfileDataSchema.parse({
    version: 1,
    updatedAt,
    profiles: [...profiles.values()],
    entries: [...entries.values()]
  })
}

function unsupportedEnvelopeVersion(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'version' in value
    && (value as { version?: unknown }).version !== 1
}

function asVaultError(error: unknown, code: VaultErrorCode, message: string): VaultError {
  return error instanceof VaultError ? error : new VaultError(code, message, { cause: error })
}

export function createProfileVault(params: {
  persistentStorage: StorageAdapter
  sessionStorage?: StorageAdapter
  iterations?: number
}): ProfileVault {
  const persistent = params.persistentStorage
  const session = params.sessionStorage
  const iterations = params.iterations ?? DEFAULT_PBKDF2_ITERATIONS
  let key: CryptoKey | null = null
  let decrypted: StoredKnowledgeBase | null = null

  const readEnvelope = async (): Promise<EncryptedVaultEnvelope | null> => {
    const raw = await persistent.get(PROFILE_VAULT_STORAGE_KEY)
    if (raw === null || raw === undefined) return null
    if (unsupportedEnvelopeVersion(raw)) {
      throw new VaultError('UNSUPPORTED_VERSION', 'Unsupported vault envelope version.')
    }
    const parsed = EncryptedVaultEnvelopeSchema.safeParse(raw)
    if (!parsed.success) throw new VaultError('CORRUPTED', 'Encrypted vault data is corrupted.')
    return parsed.data
  }

  const persistSessionKey = async (currentKey: CryptoKey, envelope: EncryptedVaultEnvelope): Promise<void> => {
    if (!session) return
    await session.set(PROFILE_VAULT_SESSION_KEY, {
      version: 1,
      key: await exportVaultKey(currentKey),
      vaultCreatedAt: envelope.createdAt
    })
  }

  const tryPersistSessionKey = async (currentKey: CryptoKey, envelope: EncryptedVaultEnvelope): Promise<void> => {
    try {
      await persistSessionKey(currentKey, envelope)
    } catch {
      try { await session?.remove(PROFILE_VAULT_SESSION_KEY) } catch { /* no persistent fallback */ }
    }
  }

  const clearSession = async (): Promise<void> => {
    key = null
    decrypted = null
    if (session) await session.remove(PROFILE_VAULT_SESSION_KEY)
  }

  const restoreSession = async (envelope: EncryptedVaultEnvelope): Promise<boolean> => {
    if (key && decrypted) return true
    if (!session) return false
    const stored = SessionVaultKeySchema.safeParse(await session.get(PROFILE_VAULT_SESSION_KEY))
    if (!stored.success || stored.data.vaultCreatedAt !== envelope.createdAt) {
      await session.remove(PROFILE_VAULT_SESSION_KEY)
      return false
    }
    try {
      const restoredKey = await importVaultKey(stored.data.key)
      const profile = await decryptProfile(envelope, restoredKey)
      key = restoredKey
      decrypted = profile
      return true
    } catch {
      await session.remove(PROFILE_VAULT_SESSION_KEY)
      return false
    }
  }

  const plaintextCandidates = async (): Promise<PlaintextCandidate[]> => {
    const candidates: PlaintextCandidate[] = []
    for (const storageKey of [CANONICAL_PROFILE_STORAGE_KEY, LEGACY_KNOWLEDGE_STORAGE_KEY]) {
      const parsed = StoredProfileDataSchema.safeParse(await persistent.get(storageKey))
      if (parsed.success) candidates.push({ key: storageKey, data: parsed.data })
    }
    if (persistent.getAll) {
      const all = await persistent.getAll()
      for (const [storageKey, value] of Object.entries(all)) {
        if ([CANONICAL_PROFILE_STORAGE_KEY, LEGACY_KNOWLEDGE_STORAGE_KEY, PROFILE_VAULT_STORAGE_KEY,
          PROFILE_VAULT_MIGRATION_STATE_KEY].includes(storageKey)) continue
        const legacy = legacyFlatProfile(value)
        if (legacy) candidates.push({ key: storageKey, data: legacy })
      }
    }
    return candidates
  }

  const malformedPlaintextKeys = async (): Promise<string[]> => {
    const malformed: string[] = []
    for (const storageKey of [CANONICAL_PROFILE_STORAGE_KEY, LEGACY_KNOWLEDGE_STORAGE_KEY]) {
      const value = await persistent.get(storageKey)
      if (value !== null && value !== undefined && !StoredProfileDataSchema.safeParse(value).success) {
        malformed.push(storageKey)
      }
    }
    if (persistent.getAll) {
      for (const [storageKey, value] of Object.entries(await persistent.getAll())) {
        if (typeof value !== 'object' || value === null || !('accountId' in value)) continue
        if (!legacyFlatProfile(value)) malformed.push(storageKey)
      }
    }
    return malformed
  }

  const writeAndVerify = async (
    envelope: EncryptedVaultEnvelope,
    verificationKey: CryptoKey,
    expected: StoredKnowledgeBase
  ): Promise<void> => {
    try {
      await persistent.set(PROFILE_VAULT_STORAGE_KEY, envelope)
      const stored = await readEnvelope()
      if (!stored) throw new Error('Encrypted vault write was not retained.')
      const verified = await decryptProfile(stored, verificationKey)
      if (!sameProfile(verified, expected)) throw new Error('Encrypted vault verification mismatch.')
    } catch (error) {
      throw asVaultError(error, 'STORAGE_WRITE_FAILED', 'Encrypted vault write could not be verified.')
    }
  }

  const api: ProfileVault = {
    async getStatus() {
      let envelope: EncryptedVaultEnvelope | null
      try {
        envelope = await readEnvelope()
      } catch (error) {
        if (error instanceof VaultError && ['CORRUPTED', 'UNSUPPORTED_VERSION'].includes(error.code)) return 'corrupted'
        throw error
      }
      if (envelope) return await restoreSession(envelope) ? 'unlocked' : 'locked'
      if (await persistent.get(PROFILE_VAULT_MIGRATION_STATE_KEY)) return 'migration-failed'
      if ((await malformedPlaintextKeys()).length) return 'migration-failed'
      const candidates = await plaintextCandidates()
      if (candidates.length) return 'migration-required'
      return 'uninitialized'
    },

    async initialize(password, profile) {
      if (await readEnvelope()) throw new VaultError('INVALID_STATE', 'Vault is already initialized.')
      if ((await plaintextCandidates()).length || (await malformedPlaintextKeys()).length) {
        throw new VaultError('INVALID_STATE', 'Existing plaintext must be migrated.')
      }
      const validated = StoredProfileDataSchema.parse(profile)
      const salt = createVaultSalt()
      const derived = await deriveVaultKey(password, salt, iterations)
      const envelope = await encryptProfile(validated, derived, { salt, iterations })
      await writeAndVerify(envelope, derived, validated)
      key = derived
      decrypted = validated
      await tryPersistSessionKey(derived, envelope)
    },

    async migrate(password) {
      if (await readEnvelope()) return
      if ((await malformedPlaintextKeys()).length) {
        await persistent.set(PROFILE_VAULT_MIGRATION_STATE_KEY, { version: 1, reason: 'malformed-plaintext' })
        throw new VaultError('MIGRATION_FAILED', 'Malformed plaintext profile records require review.')
      }
      const candidates = await plaintextCandidates()
      if (!candidates.length) {
        await persistent.set(PROFILE_VAULT_MIGRATION_STATE_KEY, { version: 1, reason: 'no-valid-plaintext' })
        throw new VaultError('MIGRATION_FAILED', 'No valid plaintext profile was found.')
      }
      let profile: StoredKnowledgeBase
      try {
        profile = mergePlaintextCandidates(candidates)
      } catch (error) {
        await persistent.set(PROFILE_VAULT_MIGRATION_STATE_KEY, { version: 1, reason: 'conflicting-plaintext' })
        throw asVaultError(error, 'MIGRATION_FAILED', 'Conflicting plaintext profile records require review.')
      }
      try {
        const salt = createVaultSalt()
        const derived = await deriveVaultKey(password, salt, iterations)
        const envelope = await encryptProfile(profile, derived, { salt, iterations })
        await writeAndVerify(envelope, derived, profile)
        const keys = [...new Set(candidates.map((candidate) => candidate.key))]
        if (persistent.removeMany) await persistent.removeMany(keys)
        else await Promise.all(keys.map(async (storageKey) => await persistent.remove(storageKey)))
        await persistent.remove(PROFILE_VAULT_MIGRATION_STATE_KEY)
        key = derived
        decrypted = profile
        await tryPersistSessionKey(derived, envelope)
      } catch (error) {
        await persistent.set(PROFILE_VAULT_MIGRATION_STATE_KEY, { version: 1, reason: 'migration-failed' })
        throw asVaultError(error, 'MIGRATION_FAILED', 'Plaintext profile migration failed.')
      }
    },

    async unlock(password) {
      const envelope = await readEnvelope()
      if (!envelope) throw new VaultError('INVALID_STATE', 'Vault is not initialized.')
      try {
        const derived = await deriveKeyForEnvelope(password, envelope)
        const profile = await decryptProfile(envelope, derived)
        key = derived
        decrypted = profile
        await tryPersistSessionKey(derived, envelope)
      } catch (error) {
        await clearSession()
        throw new VaultAuthenticationError(error)
      }
    },

    async lock() {
      await clearSession()
    },

    async isUnlocked() {
      return (await api.getStatus()) === 'unlocked'
    },

    async readProfile() {
      const envelope = await readEnvelope()
      if (!envelope || !(await restoreSession(envelope)) || !decrypted) throw new VaultLockedError()
      return StoredProfileDataSchema.parse(decrypted)
    },

    async writeProfile(profile) {
      const envelope = await readEnvelope()
      if (!envelope || !(await restoreSession(envelope)) || !key) throw new VaultLockedError()
      const validated = StoredProfileDataSchema.parse(profile)
      const saltBytes = Uint8Array.from(atob(envelope.kdf.salt), (character) => character.charCodeAt(0))
      const replacement = await encryptProfile(validated, key, {
        salt: new Uint8Array(saltBytes),
        iterations: envelope.kdf.iterations,
        createdAt: envelope.createdAt
      })
      try {
        await writeAndVerify(replacement, key, validated)
      } catch (error) {
        try { await persistent.set(PROFILE_VAULT_STORAGE_KEY, envelope) } catch { /* preserve original error */ }
        throw error
      }
      decrypted = validated
      await tryPersistSessionKey(key, replacement)
    },

    async changePassword(currentPassword, newPassword) {
      const previous = await readEnvelope()
      if (!previous) throw new VaultError('INVALID_STATE', 'Vault is not initialized.')
      let profile: StoredKnowledgeBase
      try {
        const oldKey = await deriveKeyForEnvelope(currentPassword, previous)
        profile = await decryptProfile(previous, oldKey)
      } catch (error) {
        throw new VaultAuthenticationError(error)
      }
      const salt = createVaultSalt()
      const newKey = await deriveVaultKey(newPassword, salt, iterations)
      const replacement = await encryptProfile(profile, newKey, { salt, iterations })
      try {
        await writeAndVerify(replacement, newKey, profile)
      } catch (error) {
        try { await persistent.set(PROFILE_VAULT_STORAGE_KEY, previous) } catch { /* preserve original error */ }
        throw error
      }
      key = newKey
      decrypted = profile
      await tryPersistSessionKey(newKey, replacement)
    },

    async clear() {
      await clearSession()
      const keys = [PROFILE_VAULT_STORAGE_KEY, CANONICAL_PROFILE_STORAGE_KEY,
        LEGACY_KNOWLEDGE_STORAGE_KEY, PROFILE_VAULT_MIGRATION_STATE_KEY]
      if (persistent.removeMany) await persistent.removeMany(keys)
      else await Promise.all(keys.map(async (storageKey) => await persistent.remove(storageKey)))
    }
  }

  return api
}
