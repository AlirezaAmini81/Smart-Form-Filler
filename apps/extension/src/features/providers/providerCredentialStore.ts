import { z } from 'zod'
import type { StorageAdapter } from '../suggestions/profileRepository'
import { PROFILE_VAULT_SESSION_KEY } from '../suggestions/profileVault'
import { SessionVaultKeySchema } from '../suggestions/profileVaultSchemas'
import { importVaultKey } from '../suggestions/profileVaultCrypto'
import { LlmError } from '../../lib/llm/errors'
import { ProviderIdSchema, type ProviderId } from '../../lib/llm/providerCatalog'

export const PROVIDER_CREDENTIALS_STORAGE_KEY = 'saff.providerCredentials.v1'
export const PROVIDER_CREDENTIALS_SESSION_KEY = 'saff.providerCredentials.session.v1'
export const PROVIDER_CREDENTIALS_REKEY_KEY = 'saff.providerCredentials.rekey.v1'

const CredentialRecordSchema = z.partialRecord(ProviderIdSchema, z.string().trim().min(1))
const SessionCredentialSchema = z.object({ version: z.literal(1), credentials: CredentialRecordSchema }).strict()
const RekeyMarkerSchema = z.object({ version: z.literal(1), providers: z.array(ProviderIdSchema) }).strict()
const EnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('AES-GCM'),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  providers: z.array(ProviderIdSchema),
  updatedAt: z.string().datetime()
}).strict()
type Envelope = z.infer<typeof EnvelopeSchema>

export type CredentialPersistence = 'persistent' | 'session'
export type CredentialStatus = { configured: boolean; persistence: CredentialPersistence | null; masked: string | null }

export interface ProviderCredentialStore {
  hasCredential(provider: ProviderId): Promise<boolean>
  saveCredential(provider: ProviderId, apiKey: string, persistence: CredentialPersistence): Promise<void>
  getCredential(provider: ProviderId): Promise<string>
  deleteCredential(provider: ProviderId): Promise<void>
  getStatus(provider: ProviderId): Promise<CredentialStatus>
  clearSessionCredentials(): Promise<void>
  prepareForVaultRekey(): Promise<void>
  completeVaultRekey(): Promise<void>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Uint8Array.from(encoder.encode(value)).buffer)
}

function aad(envelope: Pick<Envelope, 'version' | 'algorithm' | 'iv' | 'providers' | 'updatedAt'>): Uint8Array<ArrayBuffer> {
  return utf8(JSON.stringify(envelope))
}

export function maskCredential(configured: boolean): string | null {
  return configured ? '••••••••' : null
}

export function createProviderCredentialStore(persistent: StorageAdapter, session: StorageAdapter): ProviderCredentialStore {
  const readSession = async () => {
    const parsed = SessionCredentialSchema.safeParse(await session.get(PROVIDER_CREDENTIALS_SESSION_KEY))
    return parsed.success ? parsed.data.credentials : {}
  }
  const writeSession = async (credentials: Partial<Record<ProviderId, string>>) => {
    const parsed = SessionCredentialSchema.parse({ version: 1, credentials })
    if (Object.keys(parsed.credentials).length) await session.set(PROVIDER_CREDENTIALS_SESSION_KEY, parsed)
    else await session.remove(PROVIDER_CREDENTIALS_SESSION_KEY)
  }
  const readEnvelope = async (): Promise<Envelope | null> => {
    const parsed = EnvelopeSchema.safeParse(await persistent.get(PROVIDER_CREDENTIALS_STORAGE_KEY))
    return parsed.success ? parsed.data : null
  }
  const getVaultKey = async (): Promise<CryptoKey> => {
    const sessionKey = SessionVaultKeySchema.safeParse(await session.get(PROFILE_VAULT_SESSION_KEY))
    if (!sessionKey.success) throw new LlmError('VAULT_LOCKED', 'Enable encryption to save this API key permanently.')
    return await importVaultKey(sessionKey.data.key)
  }
  const decrypt = async (envelope: Envelope): Promise<Partial<Record<ProviderId, string>>> => {
    const key = await getVaultKey()
    try {
      const { ciphertext, ...metadata } = envelope
      const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: base64ToBytes(envelope.iv), additionalData: aad(metadata), tagLength: 128
      }, key, base64ToBytes(ciphertext))
      return CredentialRecordSchema.parse(JSON.parse(decoder.decode(plaintext)))
    } catch (error) {
      if (error instanceof LlmError) throw error
      throw new LlmError('VAULT_LOCKED', 'Provider credentials are unavailable while the vault is locked.')
    }
  }
  const encrypt = async (credentials: Partial<Record<ProviderId, string>>, createdProviders?: ProviderId[]) => {
    const validated = CredentialRecordSchema.parse(credentials)
    const key = await getVaultKey()
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
    const metadata = {
      version: 1 as const, algorithm: 'AES-GCM' as const, iv: bytesToBase64(iv),
      providers: createdProviders ?? (Object.keys(validated) as ProviderId[]), updatedAt: new Date().toISOString()
    }
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(metadata), tagLength: 128 }, key, utf8(JSON.stringify(validated)))
    await persistent.set(PROVIDER_CREDENTIALS_STORAGE_KEY, EnvelopeSchema.parse({ ...metadata, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }))
  }

  return {
    async hasCredential(provider) { return (await this.getStatus(provider)).configured },
    async saveCredential(provider, apiKey, persistenceMode) {
      const value = apiKey.trim()
      if (!value) throw new LlmError('CREDENTIAL_NOT_CONFIGURED', 'API key must not be empty.')
      if (persistenceMode === 'session') {
        await writeSession({ ...await readSession(), [provider]: value })
        return
      }
      const envelope = await readEnvelope()
      const credentials = envelope ? await decrypt(envelope) : {}
      await encrypt({ ...credentials, [provider]: value })
      const sessionCredentials = await readSession()
      delete sessionCredentials[provider]
      await writeSession(sessionCredentials)
    },
    async getCredential(provider) {
      const sessionCredential = (await readSession())[provider]
      if (sessionCredential) return sessionCredential
      const envelope = await readEnvelope()
      if (!envelope?.providers.includes(provider)) throw new LlmError('CREDENTIAL_NOT_CONFIGURED', 'Provider credential is not configured.')
      const credential = (await decrypt(envelope))[provider]
      if (!credential) throw new LlmError('CREDENTIAL_NOT_CONFIGURED', 'Provider credential is not configured.')
      return credential
    },
    async deleteCredential(provider) {
      const sessionCredentials = await readSession()
      delete sessionCredentials[provider]
      await writeSession(sessionCredentials)
      const envelope = await readEnvelope()
      if (!envelope?.providers.includes(provider)) return
      const credentials = await decrypt(envelope)
      delete credentials[provider]
      if (Object.keys(credentials).length) await encrypt(credentials)
      else await persistent.remove(PROVIDER_CREDENTIALS_STORAGE_KEY)
    },
    async getStatus(provider) {
      if ((await readSession())[provider]) return { configured: true, persistence: 'session', masked: maskCredential(true) }
      const envelope = await readEnvelope()
      const configured = envelope?.providers.includes(provider) ?? false
      return { configured, persistence: configured ? 'persistent' : null, masked: maskCredential(configured) }
    },
    async clearSessionCredentials() {
      await session.remove(PROVIDER_CREDENTIALS_SESSION_KEY)
      await session.remove(PROVIDER_CREDENTIALS_REKEY_KEY)
    },
    async prepareForVaultRekey() {
      const envelope = await readEnvelope()
      if (!envelope) return
      const persistentCredentials = await decrypt(envelope)
      await writeSession({ ...await readSession(), ...persistentCredentials })
      await session.set(PROVIDER_CREDENTIALS_REKEY_KEY, { version: 1, providers: envelope.providers })
      await persistent.remove(PROVIDER_CREDENTIALS_STORAGE_KEY)
    },
    async completeVaultRekey() {
      const marker = RekeyMarkerSchema.safeParse(await session.get(PROVIDER_CREDENTIALS_REKEY_KEY))
      if (!marker.success) return
      const sessionCredentials = await readSession()
      const staged = Object.fromEntries(marker.data.providers.flatMap((provider) => {
        const credential = sessionCredentials[provider]
        return credential ? [[provider, credential]] : []
      })) as Partial<Record<ProviderId, string>>
      if (Object.keys(staged).length) await encrypt(staged)
      for (const provider of marker.data.providers) delete sessionCredentials[provider]
      await writeSession(sessionCredentials)
      await session.remove(PROVIDER_CREDENTIALS_REKEY_KEY)
    }
  }
}

export function createChromeProviderCredentialStore(): ProviderCredentialStore | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.storage?.session) return null
  const adapter = (area: chrome.storage.StorageArea): StorageAdapter => ({
    async get(key) { const value = await area.get([key]); return value[key] ?? null },
    async set(key, value) { await area.set({ [key]: value }) },
    async remove(key) { await area.remove([key]) }
  })
  try {
    void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  } catch { /* access levels are unavailable in older Chromium */ }
  return createProviderCredentialStore(adapter(chrome.storage.local), adapter(chrome.storage.session))
}
