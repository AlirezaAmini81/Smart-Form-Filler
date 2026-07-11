# Privacy Model

Core principles (Phase 1):
- Local-first: local mode is the default — no data leaves the device.
- Encrypted by design: vault storage is planned to be encrypted using Web Crypto + IndexedDB.
- Selected-profile principle: the user must select the active profile before analysis or suggestions.
- Review-before-fill: suggestions are shown and must be explicitly approved before insertion.
- Minimal exposure: only minimal relevant data is retrieved and used for suggestions.

Phase 1 implements UI placeholders and documentation for these principles; enforcement and cryptography are planned for later phases.

Phase 6/7 updates

Local LLM flow

- Local Ollama is the default provider when configured.
- Suggestions are generated without leaving the device.
- Webpage data is treated as untrusted input.
- Prompt-injection guards flag suspicious form content.

Cloud opt-in flow

- Cloud mode is disabled by default.
- Users must explicitly opt in for each cloud request.
- The extension calls a local proxy; API keys never live in the extension bundle.

Data minimization

- Only the active profile is considered.
- Only top-ranked snippets are sent to providers.
- Raw documents are never sent to providers.

Demo knowledge storage (prototype)

- The Phase 6/7 demo can store knowledge entries in `chrome.storage.local`.
- This demo storage is not encrypted and is meant for local testing only.
- It will be replaced by the encrypted vault and teammate knowledge base module after merge.

Secret and sensitive data

- Secret snippets are blocked in cloud mode.
- Sensitive snippets in cloud mode trigger warnings.
- All suggestions require explicit user confirmation.

Prompt logging risk

- Provider prompts can be logged by external services.
- Cloud mode must not be used with secret profiles.

Provider-specific risks

- Ollama: local model quality may vary; malformed JSON is rejected.
- OpenAI proxy: network and external processing risks apply; opt-in required.
