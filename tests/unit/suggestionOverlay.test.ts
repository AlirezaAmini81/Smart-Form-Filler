import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuggestedFieldValue } from '../../packages/shared/src/schemas'

let showSuggestionsOverlay: typeof import('../../apps/extension/src/content/index')['showSuggestionsOverlay']

function suggestion(overrides: Partial<SuggestedFieldValue>): SuggestedFieldValue {
  return {
    fieldId: 'field',
    fieldLabel: 'Field',
    suggestedValue: null,
    valueType: 'unknown',
    confidence: 'low',
    reasoningSummary: 'No match.',
    provenance: {
      profileId: 'profile',
      knowledgeEntryIds: [],
      sourceIds: []
    },
    sensitivity: 'normal',
    requiresUserConfirmation: true,
    warnings: [],
    ...overrides
  }
}

describe('suggestion overlay', () => {
  beforeAll(async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: { addListener: vi.fn() }
      }
    })
    ;({ showSuggestionsOverlay } = await import('../../apps/extension/src/content/index'))
  })

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('separates fillable suggestions from unmatched detected fields', () => {
    showSuggestionsOverlay([
      suggestion({
        fieldId: 'first_name',
        fieldLabel: 'Vorname *',
        suggestedValue: 'Ada',
        valueType: 'direct-copy',
        confidence: 'high'
      }),
      suggestion({
        fieldId: 'salary',
        fieldLabel: 'Gehaltsvorstellung *'
      }),
      suggestion({
        fieldId: 'documents',
        fieldLabel: 'Bewerbungsunterlagen (komplett) *'
      })
    ], 2)

    const overlay = document.getElementById('saff-suggestion-overlay')
    expect(overlay?.textContent).toContain('Suggestions (1)')
    expect(overlay?.textContent).toContain('Detected without suggestion (2)')
    expect(overlay?.textContent).toContain('Gehaltsvorstellung *')
    expect(overlay?.textContent).toContain('Bewerbungsunterlagen (komplett) *')
    expect(overlay?.querySelectorAll('[data-saff-unmatched="true"]')).toHaveLength(2)
    expect(overlay?.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
  })
})
