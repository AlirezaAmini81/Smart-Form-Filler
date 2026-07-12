import { createChromeProviderCredentialStore } from '../features/providers/providerCredentialStore'
import { createChromeSettingsRepository } from '../features/settings/settingsRepository'
import { generateSuggestionsForPage } from '../features/suggestions/suggestionEngine'
import { PROFILE_VAULT_SESSION_KEY } from '../features/suggestions/profileVault'
import { DEFAULT_PROVIDER_TIMEOUT_MS, type ProviderRuntimeConfig } from '../lib/config/llmConfig'
import { toSerializableError, LlmError } from '../lib/llm/errors'
import { PROVIDER_CATALOG, PROVIDER_IDS, providerOriginPattern, type ProviderId } from '../lib/llm/providerCatalog'
import { createProviderRegistry } from '../lib/llm/providerRegistry'
import type { BackgroundRequest } from '../lib/messaging/types'

const settingsRepository = createChromeSettingsRepository()
const credentialStore = createChromeProviderCredentialStore()

async function hasOriginPermission(providerId: ProviderId, endpoint?: string): Promise<boolean> {
  const origin = providerOriginPattern(providerId, endpoint)
  return await chrome.permissions.contains({ origins: [origin] })
}

async function runtimeRegistry(providerId: ProviderId) {
  if (!settingsRepository || !credentialStore) throw new LlmError('PROVIDER_UNAVAILABLE', 'Extension storage is unavailable.')
  const settings = await settingsRepository.get()
  const selectedSettings = settings.provider.providers[providerId]
  const endpoint = providerId === 'ollama' ? settings.provider.providers.ollama.endpoint : undefined
  if (!await hasOriginPermission(providerId, endpoint)) throw new LlmError('PERMISSION_DENIED', 'Provider host permission has not been granted.')
  const apiKey = PROVIDER_CATALOG[providerId].credentialRequired || providerId === 'ollama'
    ? await credentialStore.getCredential(providerId).catch((error) => {
      if (providerId === 'ollama' && error instanceof LlmError && error.code === 'CREDENTIAL_NOT_CONFIGURED') return undefined
      throw error
    })
    : undefined
  const configs = Object.fromEntries(PROVIDER_IDS.map((id) => {
    const providerSettings = settings.provider.providers[id]
    const config: ProviderRuntimeConfig = {
      providerId: id,
      model: providerSettings.model,
      timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
      ...(id === 'ollama' ? { endpoint: settings.provider.providers.ollama.endpoint } : {}),
      ...(id === providerId ? { apiKey } : {})
    }
    return [id, config]
  })) as Record<ProviderId, ProviderRuntimeConfig>
  return createProviderRegistry(configs)
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && PROFILE_VAULT_SESSION_KEY in changes && changes[PROFILE_VAULT_SESSION_KEY].newValue === undefined) {
    void credentialStore?.clearSessionCredentials()
  }
})

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
  void (async () => {
    try {
      if (!credentialStore) throw new LlmError('PROVIDER_UNAVAILABLE', 'Credential storage is unavailable.')
      if (msg.type === 'GET_PROVIDER_CREDENTIAL_STATUS') {
        sendResponse({ ok: true, status: await credentialStore.getStatus(msg.payload.providerId) }); return
      }
      if (msg.type === 'SAVE_PROVIDER_CREDENTIAL') {
        await credentialStore.saveCredential(msg.payload.providerId, msg.payload.apiKey, msg.payload.persistence)
        sendResponse({ ok: true }); return
      }
      if (msg.type === 'DELETE_PROVIDER_CREDENTIAL') {
        await credentialStore.deleteCredential(msg.payload.providerId)
        sendResponse({ ok: true }); return
      }
      if (msg.type === 'PREPARE_PROVIDER_CREDENTIAL_REKEY') {
        await credentialStore.prepareForVaultRekey(); sendResponse({ ok: true }); return
      }
      if (msg.type === 'COMPLETE_PROVIDER_CREDENTIAL_REKEY') {
        await credentialStore.completeVaultRekey(); sendResponse({ ok: true }); return
      }
      if (msg.type === 'GET_LLM_PROVIDER_STATUS') {
        const provider = (await runtimeRegistry(msg.payload.providerId)).getProvider(msg.payload.providerId)
        sendResponse({ ok: true, status: await provider.testConnection() }); return
      }
      if (msg.type === 'GENERATE_FIELD_SUGGESTIONS') {
        if (!settingsRepository) throw new LlmError('PROVIDER_UNAVAILABLE', 'Settings storage is unavailable.')
        const settings = await settingsRepository.get()
        const providerId = settings.provider.selectedProvider
        const registry = await runtimeRegistry(providerId)
        const result = await generateSuggestionsForPage({
          ...msg.payload,
          providerId,
          privacyMode: PROVIDER_CATALOG[providerId].mode === 'cloud' ? 'cloud-opt-in' : 'local-only'
        }, { providerRegistry: registry })
        sendResponse({ ok: true, result }); return
      }
    } catch (error) {
      sendResponse({ ok: false, error: toSerializableError(error) })
    }
  })()
  return true
})
