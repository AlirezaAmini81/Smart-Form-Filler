import { z } from 'zod'
import { SuggestionSensitivitySchema } from '../../../../../packages/shared/src/schemas'

export const ProfileMetadataSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    sensitivity: SuggestionSensitivitySchema,
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
    sourceIds: z.array(z.string().trim().min(1)).optional()
  })
  .strict()

export const KnowledgeEntrySchema = z
  .object({
    id: z.string().trim().min(1),
    profileId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    value: z.string().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    sourceId: z.string().trim().min(1),
    sourceLabel: z.string().optional(),
    sensitivity: SuggestionSensitivitySchema
  })
  .strict()

export const StoredProfileDataSchema = z
  .object({
    version: z.literal(1),
    updatedAt: z.string().datetime(),
    profiles: z.array(ProfileMetadataSchema),
    entries: z.array(KnowledgeEntrySchema)
  })
  .strict()
  .superRefine((data, context) => {
    const profileIds = new Set(data.profiles.map((profile) => profile.id))
    if (profileIds.size !== data.profiles.length) {
      context.addIssue({ code: 'custom', message: 'Profile IDs must be unique.', path: ['profiles'] })
    }
    const entryIds = new Set(data.entries.map((entry) => entry.id))
    if (entryIds.size !== data.entries.length) {
      context.addIssue({ code: 'custom', message: 'Entry IDs must be unique.', path: ['entries'] })
    }
    for (const entry of data.entries) {
      if (!profileIds.has(entry.profileId)) {
        context.addIssue({
          code: 'custom',
          message: `Entry references unknown profile: ${entry.profileId}`,
          path: ['entries']
        })
      }
    }
  })

export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>
export type ProfileMetadata = z.infer<typeof ProfileMetadataSchema>
export type StoredKnowledgeBase = z.infer<typeof StoredProfileDataSchema>
