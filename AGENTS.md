# Repository instructions

## Product

Smart AI Form Filler is a privacy-aware Chrome Manifest V3 extension that maps user profile data to web forms and inserts only user-approved values.

## Engineering rules

- Use TypeScript with strict typing.

- Validate external and LLM-generated data with Zod.

- Never expose OpenAI API keys in the browser extension.

- Keep OpenAI and Ollama connectors behind a shared interface.

- Do not send more profile data to cloud providers than required.

- Preserve the user-approval step before filling fields.

- Do not modify unrelated files.

- Add focused Vitest tests for deterministic logic.

- Use concise communication but production-quality implementation.

## Verification

Run the smallest relevant checks:

```bash

npm run typecheck

npm test

npm run build

```

Report only:

1. files changed,

2. checks run,

3. unresolved issues.
