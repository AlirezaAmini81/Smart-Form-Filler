# Privacy Model

Core principles (Phase 1):
- Local-first: local mode is the default — no data leaves the device.
- Encrypted by design: profile data and persistent provider credentials use the password-based AES-GCM vault design.
- Selected-profile principle: the user must select the active profile before analysis or suggestions.
- Review-before-fill: suggestions are shown and must be explicitly approved before insertion.
- Minimal exposure: only minimal relevant data is retrieved and used for suggestions.

The extension enforces the review boundary, provider response validation, trusted-context storage access, and encrypted persistent credentials.

Phase 6/7 updates

Local LLM flow

- Local Ollama is the default provider when configured.
- Suggestions are generated without leaving the device.
- Webpage data is treated as untrusted input.
- Prompt-injection guards flag suspicious form content.

Cloud-provider flow

- Users select OpenAI, Anthropic Claude, or Mistral and supply their own credential.
- The service worker calls the provider directly; the application operator does not receive requests or keys.
- Provider origins are fixed and requested as optional host permissions. No arbitrary cloud endpoint is accepted.
- Keys are encrypted persistently while the vault is unlocked or retained only in trusted session storage.

Data minimization

- Only the active profile is considered.
- Only top-ranked snippets are sent to providers.
- Raw documents are never sent to providers.

Secret and sensitive data

- Secret snippets are blocked in cloud mode.
- Sensitive snippets in cloud mode trigger warnings.
- All suggestions require explicit user confirmation.

Prompt logging risk

- Provider prompts can be logged by external services.
- Cloud mode must not be used with secret profiles.

Provider-specific risks

- Ollama: local model quality may vary; malformed JSON is rejected.
- OpenAI, Anthropic, and Mistral: network and external processing risks apply; selected profile facts may reach the chosen provider.
- Browser-held credentials are not impossible to extract if an attacker gains trusted extension-context access.
