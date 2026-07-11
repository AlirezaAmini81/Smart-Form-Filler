# LLM Connector (Phase 6/7 Prototype)

This document describes the provider-based LLM connector and suggestion pipeline.

Overview

- Providers are pluggable: Ollama (local) and OpenAI (cloud via proxy).
- Local-first: Ollama is the intended default when configured.
- Cloud mode is optional and disabled by default.
- No automatic form insertion. Suggestions require user review.

Provider architecture

- LLM providers implement a shared interface: status checks and suggestion generation.
- The suggestion engine handles data minimization, policy checks, prompt-injection guards, and validation.
- Output is strictly validated with Zod before use.

Ollama provider (local)

- Default endpoint: http://localhost:11434
- Uses /api/generate with a strict JSON prompt.
- Handles not-running, missing model, timeouts, and malformed responses.

OpenAI provider (cloud, optional)

- Uses a local development proxy at http://localhost:8787.
- The extension never stores or ships API keys.
- API keys live only in the proxy .env file.
- Cloud mode must be explicitly enabled per request.

Structured output schema

Providers must return JSON with this shape:

{
  "suggestions": [
    {
      "fieldId": "field_1",
      "suggestedValue": "Example",
      "valueType": "direct-copy",
      "confidence": "high",
      "reasoningSummary": "Short user-facing rationale.",
      "knowledgeEntryIds": ["entry_id"],
      "sourceIds": ["source_id"],
      "sensitivity": "normal",
      "requiresUserConfirmation": true,
      "warnings": []
    }
  ],
  "warnings": []
}

The suggestion engine maps this output to the final suggestion type and adds provenance.

Error handling

Common errors are typed and handled explicitly:

- Provider unavailable or disabled
- Ollama not running or model missing
- Cloud mode disabled
- Proxy unreachable
- Invalid JSON or schema validation errors
- No active profile or no knowledge snippets

Prompt-injection mitigation

- Webpage and form data are untrusted by default.
- The prompt clearly separates trusted instructions, trusted knowledge, and untrusted form data.
- Guard rules flag suspicious field content (system prompt, secrets, passwords).
- Sensitive snippets are removed when prompt-injection warnings are present.

Privacy limitations

- Only minimal relevant snippets are sent to providers.
- Secret snippets are blocked in cloud mode.
- Sensitive snippets in cloud mode generate warnings.
- No automatic insertion or background autofill is performed in this phase.

Integration notes

- Knowledge retrieval uses a storage-backed demo retriever when `chrome.storage.local` is available.
- If storage is empty or unavailable, it falls back to in-memory demo entries.
- Replace the demo retriever with the teammate knowledge base module after merge.

LLM demo tab

- The popup now includes an LLM Demo tab for the full pipeline walkthrough.
- It can seed demo knowledge into `chrome.storage.local`, add entries, and list recent entries.
- Demo HTML extraction produces form field metadata for suggestion generation.
- A demo form overlay previews suggested values without inserting into the page.
