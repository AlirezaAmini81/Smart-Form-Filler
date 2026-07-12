# LLM Connector

This document describes the provider-based LLM connector and suggestion pipeline.

Overview

- Providers are pluggable: Ollama, OpenAI, Anthropic Claude, and Mistral.
- Local-first: Ollama is the intended default when configured.
- Cloud providers use user-supplied credentials encrypted locally or retained for the browser session.
- No automatic form insertion. Suggestions require user review.

Provider architecture

- LLM providers implement one shared interface for connection tests and suggestion generation.
- The Manifest V3 service worker owns provider calls, credential access, and permission checks.
- Provider-specific authentication, endpoints, request bodies, parsing, and errors stay in adapters.
- The suggestion engine handles data minimization, policy checks, prompt-injection guards, and validation.
- Output is strictly validated with Zod before use.

Ollama provider (local)

- Default endpoint: http://localhost:11434
- Uses /api/generate with a strict JSON prompt.
- Handles not-running, missing model, timeouts, and malformed responses.

Cloud providers

- OpenAI uses Chat Completions with bearer authentication and JSON response mode.
- Anthropic uses the Messages API with `x-api-key`, version headers, and text content-block extraction.
- Mistral uses Chat Completions with bearer authentication and JSON response mode.
- Cloud API origins are fixed; there is no proxy, environment API key, or arbitrary base URL.
- Persistent keys require the unlocked vault. Session-only keys are cleared on restart, reload, lock, or deletion.

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

- Provider unavailable or unreachable
- Ollama not running or model missing
- Credential missing or invalid, vault locked, permission denied, or rate limited
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

Permissions

- Provider origins are optional and requested when saving or testing a provider.
- Ollama endpoints are configurable only on localhost or loopback addresses.
- Content scripts receive neither credentials nor raw provider responses.
