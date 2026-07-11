import type {
  PrivacyMode,
  RetrievedKnowledgeSnippet,
  SuggestionWarning
} from '../../features/suggestions/suggestionTypes'
import type { LlmProviderMode } from '../../features/suggestions/suggestionTypes'

export interface SensitiveDataPolicyResult {
  allowedSnippets: RetrievedKnowledgeSnippet[]
  blockedSnippets: RetrievedKnowledgeSnippet[]
  warnings: SuggestionWarning[]
}

export function applySensitiveDataPolicy(
  snippets: RetrievedKnowledgeSnippet[],
  params: {
    providerMode: LlmProviderMode
    privacyMode: PrivacyMode
    promptInjectionDetected: boolean
  }
): SensitiveDataPolicyResult {
  const warnings: SuggestionWarning[] = []
  const blockedSnippets: RetrievedKnowledgeSnippet[] = []

  let allowed = [...snippets]

  const isCloud = params.providerMode === 'cloud' || params.privacyMode === 'cloud-opt-in'

  if (isCloud) {
    const [safe, blocked] = partitionSnippets(allowed, (snippet) => snippet.sensitivity !== 'secret')
    allowed = safe
    blockedSnippets.push(...blocked)

    if (blocked.length > 0) {
      warnings.push({
        code: 'SECRET_BLOCKED',
        message: 'Secret knowledge snippets were removed for cloud mode.'
      })
    }

    const hasSensitive = safe.some((snippet) => snippet.sensitivity === 'sensitive')
    if (hasSensitive) {
      warnings.push({
        code: 'SENSITIVE_IN_CLOUD',
        message: 'Sensitive snippets are included in cloud mode. Review carefully.'
      })
    }
  }

  if (params.promptInjectionDetected) {
    const [safe, blocked] = partitionSnippets(
      allowed,
      (snippet) => snippet.sensitivity !== 'sensitive' && snippet.sensitivity !== 'secret'
    )
    allowed = safe
    blockedSnippets.push(...blocked)

    if (blocked.length > 0) {
      warnings.push({
        code: 'SENSITIVE_BLOCKED',
        message: 'Sensitive snippets were removed due to prompt injection warnings.'
      })
    }
  }

  return {
    allowedSnippets: allowed,
    blockedSnippets,
    warnings
  }
}

function partitionSnippets(
  snippets: RetrievedKnowledgeSnippet[],
  predicate: (snippet: RetrievedKnowledgeSnippet) => boolean
): [RetrievedKnowledgeSnippet[], RetrievedKnowledgeSnippet[]] {
  const passed: RetrievedKnowledgeSnippet[] = []
  const failed: RetrievedKnowledgeSnippet[] = []

  snippets.forEach((snippet) => {
    if (predicate(snippet)) {
      passed.push(snippet)
    } else {
      failed.push(snippet)
    }
  })

  return [passed, failed]
}
