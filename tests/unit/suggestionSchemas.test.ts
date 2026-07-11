import { describe, it, expect } from 'vitest'
import { SuggestionGenerationResponseSchema } from '../../apps/extension/src/features/suggestions/suggestionSchemas'

describe('SuggestionGenerationResponseSchema', () => {
  it('accepts a valid response', () => {
    const valid = {
      suggestions: [
        {
          fieldId: 'field_1',
          suggestedValue: 'Ada Lovelace',
          valueType: 'direct-copy',
          confidence: 'high',
          reasoningSummary: 'Matches the name field.',
          knowledgeEntryIds: ['entry_full_name'],
          sourceIds: ['source_manual'],
          sensitivity: 'normal',
          requiresUserConfirmation: true,
          warnings: []
        }
      ],
      warnings: []
    }

    expect(() => SuggestionGenerationResponseSchema.parse(valid)).not.toThrow()
  })

  it('rejects an invalid response', () => {
    const invalid = {
      suggestions: [{ fieldId: 'field_1' }],
      warnings: []
    }

    expect(() => SuggestionGenerationResponseSchema.parse(invalid)).toThrow()
  })
})
