import { z } from 'zod'

// Form analysis types
export const FormFieldKind = z.enum(['input', 'textarea', 'select'])

export const FormFieldMetadataSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  type: z.string().optional(),
  kind: FormFieldKind,
  label: z.string().optional(),
  placeholder: z.string().optional(),
  ariaLabel: z.string().optional()
})

export type FormFieldMetadata = z.infer<typeof FormFieldMetadataSchema>

export const FormAnalysisResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  inputs: z.number(),
  textareas: z.number(),
  selects: z.number()
})

export type FormAnalysisResult = z.infer<typeof FormAnalysisResultSchema>

// Vault / profile placeholders
export const KnowledgeBaseProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string()
})

export type KnowledgeBaseProfile = z.infer<typeof KnowledgeBaseProfileSchema>

// Local LLM status placeholder
export const LocalLlmStatusSchema = z.object({
  connected: z.boolean(),
  provider: z.string().optional()
})

export type LocalLlmStatus = z.infer<typeof LocalLlmStatusSchema>

// Suggestion schemas
export const SuggestionConfidenceSchema = z.enum(['low', 'medium', 'high'])
export type SuggestionConfidence = z.infer<typeof SuggestionConfidenceSchema>

export const SuggestionValueTypeSchema = z.enum([
  'direct-copy',
  'normalized',
  'generated',
  'unknown'
])
export type SuggestionValueType = z.infer<typeof SuggestionValueTypeSchema>

export const SuggestionSensitivitySchema = z.enum([
  'public',
  'normal',
  'sensitive',
  'secret'
])
export type SuggestionSensitivity = z.infer<typeof SuggestionSensitivitySchema>

export const SuggestionProvenanceSchema = z.object({
  profileId: z.string(),
  knowledgeEntryIds: z.array(z.string()),
  sourceIds: z.array(z.string()),
  sourceLabels: z.array(z.string()).optional()
})
export type SuggestionProvenance = z.infer<typeof SuggestionProvenanceSchema>

export const SuggestedFieldValueSchema = z.object({
  fieldId: z.string(),
  fieldName: z.string().optional(),
  fieldLabel: z.string().optional(),
  suggestedValue: z.string().nullable(),
  valueType: SuggestionValueTypeSchema,
  confidence: SuggestionConfidenceSchema,
  reasoningSummary: z.string(),
  provenance: SuggestionProvenanceSchema,
  sensitivity: SuggestionSensitivitySchema,
  requiresUserConfirmation: z.boolean(),
  warnings: z.array(z.string())
})

export type SuggestedFieldValue = z.infer<typeof SuggestedFieldValueSchema>

export const SuggestionGenerationResponseSchema = z
  .object({
    suggestions: z.array(
      z
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
    ),
    warnings: z.array(z.string())
  })
  .strict()

export type SuggestionGenerationResponse = z.infer<typeof SuggestionGenerationResponseSchema>

// Vault state placeholder
export const VaultStateSchema = z.object({
  locked: z.boolean(),
  activeProfileId: z.string().nullable()
})

export type VaultState = z.infer<typeof VaultStateSchema>
