import type { SuggestionField, SuggestionWarning } from '../../features/suggestions/suggestionTypes'

type GuardSeverity = 'none' | 'low' | 'high'

type SuspiciousPattern = {
  pattern: RegExp
  reason: string
  severity: GuardSeverity
}

const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    pattern: /ignore (all|previous) instructions/i,
    reason: 'Possible prompt override attempt',
    severity: 'high'
  },
  {
    pattern: /system prompt|developer message/i,
    reason: 'Mentions system or developer instructions',
    severity: 'high'
  },
  {
    pattern: /api key|secret|token/i,
    reason: 'Requests secret or token-like data',
    severity: 'high'
  },
  {
    pattern: /reveal|exfiltrate|bypass/i,
    reason: 'Suspicious request to bypass safeguards',
    severity: 'high'
  },
  {
    pattern: /password|passphrase/i,
    reason: 'Requests password-like data',
    severity: 'high'
  }
]

function extractFieldText(field: SuggestionField): string {
  return [field.label, field.name, field.placeholder, field.ariaLabel, field.type]
    .filter(Boolean)
    .join(' ')
}

export interface PromptInjectionGuardResult {
  warnings: SuggestionWarning[]
  flaggedFieldIds: string[]
  fieldWarnings: Record<string, string[]>
  hasSuspiciousFields: boolean
  severity: GuardSeverity
}

export function runPromptInjectionGuards(fields: SuggestionField[]): PromptInjectionGuardResult {
  const warnings: SuggestionWarning[] = []
  const flaggedFieldIds: string[] = []
  const fieldWarnings: Record<string, string[]> = {}
  let severity: GuardSeverity = 'none'

  fields.forEach((field) => {
    const fieldText = extractFieldText(field)
    const matched: string[] = []

    SUSPICIOUS_PATTERNS.forEach((pattern) => {
      if (pattern.pattern.test(fieldText)) {
        matched.push(pattern.reason)
        if (pattern.severity === 'high') {
          severity = 'high'
        } else if (severity === 'none') {
          severity = 'low'
        }
      }
    })

    if (field.type?.toLowerCase() === 'password') {
      matched.push('Field type indicates a password input')
      severity = 'high'
    }

    if (matched.length > 0) {
      flaggedFieldIds.push(field.id)
      fieldWarnings[field.id] = matched
      matched.forEach((reason) => {
        warnings.push({
          code: 'PROMPT_INJECTION',
          message: reason,
          fieldId: field.id
        })
      })
    }
  })

  return {
    warnings,
    flaggedFieldIds,
    fieldWarnings,
    hasSuspiciousFields: flaggedFieldIds.length > 0,
    severity
  }
}
