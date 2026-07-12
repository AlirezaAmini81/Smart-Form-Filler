import { StoredProfileDataSchema, type StoredKnowledgeBase } from './knowledgeTypes'
import {
  EncryptedVaultEnvelopeSchema,
  type EncryptedVaultEnvelope
} from './profileVaultSchemas'

export const DEFAULT_PBKDF2_ITERATIONS = 310_000

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

function additionalData(envelope: Omit<EncryptedVaultEnvelope, 'ciphertext'>): Uint8Array<ArrayBuffer> {
  return utf8(JSON.stringify({
    version: envelope.version,
    algorithm: envelope.algorithm,
    kdf: envelope.kdf,
    iv: envelope.iv,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt
  }))
}

export async function deriveVaultKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<CryptoKey> {
  if (!password) throw new TypeError('Vault password must not be empty.')
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function encryptProfile(
  profile: StoredKnowledgeBase,
  key: CryptoKey,
  params: { salt: Uint8Array<ArrayBuffer>; iterations: number; createdAt?: string }
): Promise<EncryptedVaultEnvelope> {
  const validated = StoredProfileDataSchema.parse(profile)
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
  const now = new Date().toISOString()
  const metadata = {
    version: 1 as const,
    algorithm: 'AES-GCM' as const,
    kdf: {
      name: 'PBKDF2' as const,
      hash: 'SHA-256' as const,
      salt: bytesToBase64(params.salt),
      iterations: params.iterations
    },
    iv: bytesToBase64(iv),
    createdAt: params.createdAt ?? now,
    updatedAt: now
  }
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(metadata), tagLength: 128 },
    key,
    utf8(JSON.stringify(validated))
  )
  return EncryptedVaultEnvelopeSchema.parse({
    ...metadata,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  })
}

export async function decryptProfile(
  envelopeInput: EncryptedVaultEnvelope,
  key: CryptoKey
): Promise<StoredKnowledgeBase> {
  const envelope = EncryptedVaultEnvelopeSchema.parse(envelopeInput)
  const { ciphertext, ...metadata } = envelope
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(envelope.iv),
      additionalData: additionalData(metadata),
      tagLength: 128
    },
    key,
    base64ToBytes(ciphertext)
  )
  return StoredProfileDataSchema.parse(JSON.parse(decoder.decode(plaintext)))
}

export async function deriveKeyForEnvelope(
  password: string,
  envelope: EncryptedVaultEnvelope
): Promise<CryptoKey> {
  return await deriveVaultKey(password, base64ToBytes(envelope.kdf.salt), envelope.kdf.iterations)
}

export async function exportVaultKey(key: CryptoKey): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

export async function importVaultKey(encoded: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', base64ToBytes(encoded), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt'
  ])
}

export function createVaultSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))
}
