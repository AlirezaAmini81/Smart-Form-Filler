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

// Suggestion placeholder
export const SuggestedFieldValueSchema = z.object({
  fieldName: z.string(),
  value: z.string(),
  confidence: z.number().optional()
})

export type SuggestedFieldValue = z.infer<typeof SuggestedFieldValueSchema>

// Vault state placeholder
export const VaultStateSchema = z.object({
  locked: z.boolean(),
  activeProfileId: z.string().nullable()
})

export type VaultState = z.infer<typeof VaultStateSchema>
