# Smart Form Filler

Privacy-first local personal knowledge system — Phase 1 skeleton.

This repository contains a Phase 1 Chrome extension (Manifest V3) built with React, TypeScript, Vite and Tailwind. It is a minimal, privacy-focused scaffold for a local encrypted knowledge vault and a review-before-fill form assistant.

See docs for architecture and next steps.

Local setup

1. Install dependencies:

```bash
npm install
```

2. Build extension:

```bash
npm run build
```

3. Load unpacked extension in Chrome: select the `apps/extension/dist` folder.

Dev notes

- `npm run dev` runs Vite (useful during development of popup UI).
- `npm run test` runs unit tests (Vitest).
- `npm run typecheck` runs `tsc` type checking.

LLM providers

Ollama local provider

1. Install and start Ollama.
2. Pull a small model, for example:
	- `ollama pull llama3.2:3b`
3. Ensure Ollama runs at http://localhost:11434.
4. In Settings → Providers, select Ollama, choose a model, grant the loopback permission, and test the connection.

Cloud providers

1. Enable and unlock the encrypted vault for persistent credentials, or choose session-only storage.
2. In Settings → Providers, select OpenAI, Anthropic Claude, or Mistral.
3. Enter your API key and model, grant the provider-specific host permission, save, and test the connection.
4. Analyze a form from the popup and review suggestions before filling.

The service worker calls the provider directly; there is no application proxy. Selected profile facts may be sent to the chosen cloud provider. Secret snippets remain blocked and every fill requires approval.
