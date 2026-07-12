import { z } from 'zod'
import { SuggestionSensitivitySchema } from '../../../../packages/shared/src/schemas'
import type { KnowledgeEntry } from '../features/suggestions/knowledgeTypes'
import type { ProfileRepository } from '../features/suggestions/profileRepository'
import type { SuggestionSensitivity } from '../features/suggestions/suggestionTypes'

const FixedProfileValuesSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    'professional-title': z.string().trim().max(300).optional(),
    'e-mail': z.string().trim().max(320).optional(),
    phone: z.string().trim().max(100).optional(),
    location: z.string().trim().max(500).optional(),
    street: z.string().trim().max(500).optional(),
    postalcode: z.string().trim().max(100).optional(),
    age: z.string().trim().max(20).optional()
  })
  .strict()

const ReviewedEntrySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(8_000),
    long: z.boolean(),
    sensitivity: SuggestionSensitivitySchema
  })
  .strict()

const SaveReviewedProfileSchema = z
  .object({
    confirmed: z.literal(true),
    profileId: z.string().trim().min(1).max(200),
    profileName: z.string().trim().min(1).max(200),
    values: FixedProfileValuesSchema,
    entries: z.array(ReviewedEntrySchema).max(100),
    fieldSensitivity: z.record(z.string(), SuggestionSensitivitySchema),
    sourceId: z.string().trim().min(1).max(200),
    sourceLabel: z.string().trim().min(1).max(500)
  })
  .strict()
  .superRefine((data, context) => {
    const hasFixedValue = Object.values(data.values).some(Boolean)
    if (!hasFixedValue && data.entries.length === 0) {
      context.addIssue({ code: 'custom', message: 'At least one reviewed profile value is required.' })
    }
  })

export type SaveReviewedProfileInput = z.input<typeof SaveReviewedProfileSchema>

const FIXED_FIELD_LABELS: Record<keyof z.infer<typeof FixedProfileValuesSchema>, string> = {
  name: 'Full name',
  'professional-title': 'Professional title',
  'e-mail': 'E-mail address',
  phone: 'Phone number',
  location: 'City / location',
  street: 'Street address',
  postalcode: 'Postal code',
  age: 'Age'
}

const DEFAULT_FIELD_SENSITIVITY: Partial<Record<keyof typeof FIXED_FIELD_LABELS, SuggestionSensitivity>> = {
  'e-mail': 'sensitive',
  phone: 'sensitive',
  street: 'sensitive',
  postalcode: 'sensitive',
  location: 'sensitive',
  age: 'sensitive'
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function createEntryId(label: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `entry_${slugify(label) || 'entry'}_${suffix}`
}

function inferSensitivity(label: string): SuggestionSensitivity {
  const lowered = label.toLowerCase()
  if (/(password|token|secret|api key|private key)/.test(lowered)) return 'secret'
  if (/(passport|iban|bank|address|email|phone|id|license)/.test(lowered)) return 'sensitive'
  return 'normal'
}

export async function saveReviewedProfile(
  repository: ProfileRepository,
  input: SaveReviewedProfileInput
): Promise<void> {
  const reviewed = SaveReviewedProfileSchema.parse(input)
  const fixedEntries: KnowledgeEntry[] = Object.entries(reviewed.values).flatMap(([key, value]) => {
    if (!value) return []
    const typedKey = key as keyof typeof FIXED_FIELD_LABELS
    const label = FIXED_FIELD_LABELS[typedKey]
    return [{
      id: createEntryId(label),
      profileId: reviewed.profileId,
      label,
      value,
      sourceId: reviewed.sourceId,
      sourceLabel: reviewed.sourceLabel,
      sensitivity: reviewed.fieldSensitivity[key] ?? DEFAULT_FIELD_SENSITIVITY[typedKey] ?? inferSensitivity(label)
    }]
  })
  const customEntries: KnowledgeEntry[] = reviewed.entries.map((entry) => ({
    id: createEntryId(entry.title),
    profileId: reviewed.profileId,
    label: entry.title,
    value: entry.content,
    summary: entry.long ? entry.content.slice(0, 120) : undefined,
    sourceId: reviewed.sourceId,
    sourceLabel: reviewed.sourceLabel,
    sensitivity: entry.sensitivity
  }))

  await repository.upsertProfile(
    { id: reviewed.profileId, name: reviewed.profileName, sensitivity: 'normal' },
    [...fixedEntries, ...customEntries]
  )
}
