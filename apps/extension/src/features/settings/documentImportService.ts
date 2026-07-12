import { z } from 'zod'
import type { ParsedCvData } from '../import/pdfCvParser'
import { StoredProfileDataSchema, type KnowledgeEntry } from '../suggestions/knowledgeTypes'
import type { ProfileRepository } from '../suggestions/profileRepository'

export type ImportConflictDecision = 'keep' | 'replace' | 'alternative'

export type ImportCandidate = {
  id: string
  label: string
  value: string
  sensitivity: KnowledgeEntry['sensitivity']
  decision: ImportConflictDecision
}

const ConfirmedImportSchema = z.object({
  confirmed: z.literal(true),
  profileId: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  sourceLabel: z.string().trim().min(1),
  candidates: z.array(z.object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(8_000),
    sensitivity: z.enum(['public', 'normal', 'sensitive', 'secret']),
    decision: z.enum(['keep', 'replace', 'alternative'])
  }).strict()).min(1).max(100)
}).strict()

const FIXED_LABELS: Record<string, string> = {
  name: 'Full name',
  'first-name': 'First name',
  'last-name': 'Last name',
  'date-of-birth': 'Date of birth',
  age: 'Age',
  gender: 'Gender',
  salutation: 'Salutation',
  nationality: 'Nationality',
  'marital-status': 'Marital status',
  'professional-title': 'Professional title',
  'e-mail': 'E-mail address',
  phone: 'Phone number',
  'mobile-phone': 'Mobile phone',
  location: 'City / location',
  'street-address': 'Street address',
  'postal-code': 'Postal code',
  city: 'City',
  state: 'State',
  country: 'Country',
  'full-address': 'Full address'
}

const SENSITIVE_FIXED_VALUES = new Set([
  'date-of-birth',
  'gender',
  'e-mail',
  'phone',
  'mobile-phone',
  'location',
  'street-address',
  'postal-code',
  'city',
  'state',
  'full-address'
])

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
}

export function parsedCvToCandidates(parsed: ParsedCvData): ImportCandidate[] {
  const candidates = [
    ...Object.entries(parsed.values).map(([key, value]) => ({
      id: id('candidate'),
      label: FIXED_LABELS[key] ?? key,
      value,
      sensitivity: SENSITIVE_FIXED_VALUES.has(key) ? 'sensitive' as const : 'normal' as const,
      decision: 'replace' as const
    })),
    ...parsed.entries.map((entry) => ({
      id: id('candidate'),
      label: entry.title,
      value: entry.content,
      sensitivity: entry.sensitivity,
      decision: 'replace' as const
    }))
  ]
  const seenLabels = new Set<string>()
  return candidates.map((candidate) => {
    const label = candidate.label.trim().toLowerCase()
    const decision = seenLabels.has(label) ? 'alternative' as const : candidate.decision
    seenLabels.add(label)
    return { ...candidate, decision }
  })
}

export async function confirmDocumentImport(
  repository: ProfileRepository,
  input: z.input<typeof ConfirmedImportSchema>
): Promise<void> {
  const reviewed = ConfirmedImportSchema.parse(input)
  const current = await repository.get()
  if (!current?.profiles.some((profile) => profile.id === reviewed.profileId)) {
    throw new Error('Target profile was not found.')
  }
  let entries = [...current.entries]
  for (const candidate of reviewed.candidates) {
    const conflicts = entries.filter((entry) =>
      entry.profileId === reviewed.profileId && entry.label.toLowerCase() === candidate.label.toLowerCase()
    )
    if (conflicts.length && candidate.decision === 'keep') continue
    if (candidate.decision === 'replace') {
      entries = entries.filter((entry) => !conflicts.includes(entry))
    }
    entries.push({
      id: id('entry'),
      profileId: reviewed.profileId,
      label: candidate.label,
      value: candidate.value,
      sensitivity: candidate.sensitivity,
      sourceId: reviewed.sourceId,
      sourceLabel: reviewed.sourceLabel
    })
  }
  const timestamp = new Date().toISOString()
  await repository.save(StoredProfileDataSchema.parse({
    ...current,
    updatedAt: timestamp,
    profiles: current.profiles.map((profile) => profile.id === reviewed.profileId
      ? {
        ...profile,
        updatedAt: timestamp,
        sourceIds: [...new Set([...(profile.sourceIds ?? []), reviewed.sourceId])]
      }
      : profile),
    entries
  }))
}
