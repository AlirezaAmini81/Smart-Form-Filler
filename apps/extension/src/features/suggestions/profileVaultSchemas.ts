import { z } from 'zod'

const Base64Schema = z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/)

function decodedLength(value: string): number {
  try { return atob(value).length } catch { return -1 }
}

const SaltSchema = Base64Schema.refine((value) => decodedLength(value) === 16, 'Salt must contain 16 bytes.')
const IvSchema = Base64Schema.refine((value) => decodedLength(value) === 12, 'IV must contain 12 bytes.')
const CiphertextSchema = Base64Schema.refine(
  (value) => decodedLength(value) >= 16,
  'Ciphertext must contain an authentication tag.'
)
const Aes256KeySchema = Base64Schema.refine((value) => decodedLength(value) === 32, 'Key must contain 32 bytes.')

export const EncryptedVaultEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('AES-GCM'),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    hash: z.literal('SHA-256'),
    salt: SaltSchema,
    iterations: z.number().int().min(100_000).max(10_000_000)
  }).strict(),
  iv: IvSchema,
  ciphertext: CiphertextSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()

export type EncryptedVaultEnvelope = z.infer<typeof EncryptedVaultEnvelopeSchema>

export const SessionVaultKeySchema = z.object({
  version: z.literal(1),
  key: Aes256KeySchema,
  vaultCreatedAt: z.string().datetime()
}).strict()

export type SessionVaultKey = z.infer<typeof SessionVaultKeySchema>
