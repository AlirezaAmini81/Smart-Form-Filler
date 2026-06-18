import { SuggestionGenerationResponseSchema } from '../../features/suggestions/suggestionSchemas'
import type { SuggestionGenerationResponse } from '../../features/suggestions/suggestionTypes'
import { LlmError } from './errors'

const JSON_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/i

function extractJsonFromText(text: string): string | null {
  const fenced = text.match(JSON_FENCE_REGEX)
  if (fenced?.[1]) {
    return fenced[1]
  }

  const start = text.indexOf('{')
  if (start === -1) {
    return null
  }

  let depth = 0
  let inString = false
  let isEscaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (char === '\\') {
      isEscaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
    }

    if (!inString) {
      if (char === '{') {
        depth += 1
      }
      if (char === '}') {
        depth -= 1
        if (depth === 0) {
          return text.slice(start, i + 1)
        }
      }
    }
  }

  return null
}

export function parseSuggestionResponse(input: unknown): SuggestionGenerationResponse {
  let candidate: unknown = input

  if (typeof input === 'string') {
    const extracted = extractJsonFromText(input)
    if (!extracted) {
      throw new LlmError('INVALID_JSON', 'No JSON object found in provider response.')
    }

    try {
      candidate = JSON.parse(extracted)
    } catch (error) {
      throw new LlmError('INVALID_JSON', 'Failed to parse JSON from provider response.')
    }
  }

  const parsed = SuggestionGenerationResponseSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new LlmError('SCHEMA_VALIDATION_ERROR', 'Provider response did not match schema.')
  }

  return parsed.data
}
