import type { ProviderId } from '../llm/providerCatalog'

export type ProviderRuntimeConfig = {
  providerId: ProviderId
  model: string
  endpoint?: string
  apiKey?: string
  timeoutMs: number
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = 200_000
