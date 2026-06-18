export type LlmErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_DISABLED'
  | 'CLOUD_MODE_DISABLED'
  | 'OPENAI_PROXY_UNAVAILABLE'
  | 'OPENAI_API_KEY_MISSING'
  | 'OLLAMA_NOT_RUNNING'
  | 'OLLAMA_MODEL_MISSING'
  | 'TIMEOUT'
  | 'INVALID_JSON'
  | 'SCHEMA_VALIDATION_ERROR'
  | 'NO_ACTIVE_PROFILE'
  | 'NO_KNOWLEDGE_SNIPPETS'
  | 'PROMPT_INJECTION_DETECTED'
  | 'UNKNOWN_PROVIDER'
  | 'PROVIDER_ERROR'

export class LlmError extends Error {
  readonly code: LlmErrorCode
  readonly details?: string

  constructor(code: LlmErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.details = details
  }
}

export function isLlmError(error: unknown): error is LlmError {
  return error instanceof LlmError
}

export type SerializableLlmError = {
  code: LlmErrorCode
  message: string
  details?: string
}

export function toSerializableError(error: unknown): SerializableLlmError {
  if (isLlmError(error)) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    }
  }

  if (error instanceof Error) {
    return {
      code: 'PROVIDER_ERROR',
      message: error.message
    }
  }

  return {
    code: 'PROVIDER_ERROR',
    message: 'Unknown error occurred.'
  }
}
