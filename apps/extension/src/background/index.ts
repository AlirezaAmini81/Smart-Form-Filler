import { getDefaultLlmConfig, mergeLlmConfig } from '../lib/config/llmConfig'
import { toSerializableError } from '../lib/llm/errors'
import { createProviderRegistry } from '../lib/llm/providerRegistry'
import type { BackgroundRequest } from '../lib/messaging/types'
import { generateSuggestionsForPage } from '../features/suggestions/suggestionEngine'

// Background service worker
// Coordinates messaging between popup, content script, and suggestion engine.
chrome.runtime.onInstalled.addListener(() => {
  console.log('[saff] background worker installed')
})

console.log('[saff] background worker running')

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
  console.log('[saff] background received message', msg)

  if (msg?.type === 'GET_LLM_PROVIDER_STATUS') {
    const baseConfig = getDefaultLlmConfig()
    const resolvedConfig = mergeLlmConfig(baseConfig, {
      openai: {
        cloudEnabled: msg.payload?.privacyMode === 'cloud-opt-in'
      }
    })
    const registry = createProviderRegistry(resolvedConfig)

    ;(async () => {
      try {
        if (msg.payload?.providerId) {
          const provider = registry.getProvider(msg.payload.providerId)
          const status = await provider.getStatus()
          sendResponse({ ok: true, status })
          return
        }

        const status = await registry.getProviderStatuses()
        sendResponse({ ok: true, status })
      } catch (error) {
        sendResponse({ ok: false, error: toSerializableError(error) })
      }
    })()

    return true
  }

  if (msg?.type === 'GENERATE_FIELD_SUGGESTIONS') {
    ;(async () => {
      try {
        const result = await generateSuggestionsForPage(msg.payload)
        sendResponse({ ok: true, result })
      } catch (error) {
        sendResponse({ ok: false, error: toSerializableError(error) })
      }
    })()

    return true
  }
})
