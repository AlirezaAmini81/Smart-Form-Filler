import { LlmError } from './errors'

export async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new LlmError('TIMEOUT', 'Provider request timed out.')
    throw new LlmError('PROVIDER_UNAVAILABLE', 'Provider is unreachable.')
  } finally {
    clearTimeout(timeout)
  }
}

export async function requireOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return
  const details = await response.text().catch(() => '')
  if (response.status === 401 || response.status === 403) {
    throw new LlmError('INVALID_CREDENTIAL', `${provider} rejected the API credential.`)
  }
  if (response.status === 429) throw new LlmError('RATE_LIMITED', `${provider} rate limit reached.`)
  if (response.status === 404 || /model/i.test(details)) {
    throw new LlmError('MODEL_UNAVAILABLE', `${provider} model is unavailable.`)
  }
  throw new LlmError('PROVIDER_UNAVAILABLE', `${provider} returned HTTP ${response.status}.`)
}

export async function readJson(response: Response, provider: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new LlmError('INVALID_JSON', `${provider} returned invalid JSON.`)
  }
}
