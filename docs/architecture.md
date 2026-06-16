# Architecture (Phase 1)

This document describes the Phase 1 architecture and placeholders for the Smart Form Filler project.

Key components:
- Popup UI: React-based popup (apps/extension). Shows active profile, vault status, local LLM status, and analysis controls.
- Content Script: extracts form metadata (placeholder). Runs on web pages and responds to analysis requests.
- Background Service Worker: coordinates messaging (placeholder).
- Encrypted Vault: placeholder module; planned to use IndexedDB + Web Crypto API.
- Setup Assistant: UI placeholder for later ingestion and parsing features.
- Local LLM connector: provider abstraction with a mock provider in Phase 1.
- Suggestion Engine: placeholder for later suggestion generation and provenance.

Phase 1 delivers a working popup, content script communication, mock analysis, shared types/schemas, and documentation skeleton.
