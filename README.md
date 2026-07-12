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

LLM connector demo (Phase 6/7)

Ollama local provider

1. Install and start Ollama.
2. Pull a small model, for example:
	- `ollama pull llama3.2:3b`
3. Ensure Ollama runs at http://localhost:11434.
4. Open the LLM Demo tab and select Ollama (local).
5. Click Generate suggestions to verify the connection.

OpenAI proxy (optional, cloud mode)

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
2. Optionally set `OPENAI_MODEL` and `PORT`.
3. Start the proxy: `npm run dev:api`.
4. In the LLM Demo tab, select OpenAI (cloud) and opt in to cloud mode.
5. Generate suggestions and confirm the cloud warning is shown.

Cloud mode is optional and disabled by default. Do not use secret profiles in cloud mode.
# Smart AI Form Filler
