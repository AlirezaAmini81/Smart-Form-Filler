import { describe, it, expect } from 'vitest'
import { parseSuggestionResponse } from '../../apps/extension/src/lib/llm/responseParser'

describe('responseParser', () => {
  it('parses direct JSON', () => {
    const json = JSON.stringify({
      suggestions: [
        {
          fieldId: 'field_1',
          suggestedValue: 'Ada',
          valueType: 'direct-copy',
          confidence: 'high',
          reasoningSummary: 'Match',
          knowledgeEntryIds: ['entry_1'],
          sourceIds: ['source_1'],
          sensitivity: 'normal',
          requiresUserConfirmation: true,
          warnings: []
        }
      ],
      warnings: []
    })

    const result = parseSuggestionResponse(json)
    expect(result.suggestions).toHaveLength(1)
  })

  it('parses JSON inside markdown fences', () => {
    const json = JSON.stringify({
      suggestions: [
        {
          fieldId: 'field_2',
          suggestedValue: 'Ada',
          valueType: 'direct-copy',
          confidence: 'high',
          reasoningSummary: 'Match',
          knowledgeEntryIds: ['entry_2'],
          sourceIds: ['source_2'],
          sensitivity: 'normal',
          requiresUserConfirmation: true,
          warnings: []
        }
      ],
      warnings: []
    })

    const result = parseSuggestionResponse(
      `Here is JSON:\n\n\`\`\`json\n${json}\n\`\`\``
    )
    expect(result.suggestions[0].fieldId).toBe('field_2')
  })

  it('rejects invalid JSON', () => {
    expect(() => parseSuggestionResponse('not json')).toThrow()
  })
})
