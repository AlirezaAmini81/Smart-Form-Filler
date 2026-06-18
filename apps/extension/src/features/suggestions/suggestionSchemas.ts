import { z } from 'zod'
import {
  SuggestionConfidenceSchema,
  SuggestionSensitivitySchema,
  SuggestionValueTypeSchema
} from '../../../../../packages/shared/src/schemas'

export const ProviderSuggestionSchema = z
  .object({
    fieldId: z.string(),
    suggestedValue: z.string().nullable(),
    valueType: SuggestionValueTypeSchema,
    confidence: SuggestionConfidenceSchema,
    reasoningSummary: z.string(),
    knowledgeEntryIds: z.array(z.string()),
    sourceIds: z.array(z.string()),
    sensitivity: SuggestionSensitivitySchema,
    requiresUserConfirmation: z.boolean(),
    warnings: z.array(z.string())
  })
  .strict()

export const SuggestionGenerationResponseSchema = z
  .object({
    suggestions: z.array(ProviderSuggestionSchema),
    warnings: z.array(z.string())
  })
  .strict()
