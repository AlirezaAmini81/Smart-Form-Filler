**Project Doc: Smart Form Filler**  
**0 . Cover**  
| | |  
|-|-|  
| **Project name:** | **Smart Form Filler** |   
| **Team members:** | Alireza Amini, Benedikt Peterson |   
| **Date / version:** | 2026‑07‑12 / v0.2 planning update |   
| **Core idea:** | A privacy-aware browser extension that maps a user’s profile to arbitrary forms and proposes verified, editable form entries. |   
| **Course** | SWP SS 2026 - Chat, Search and Summaries: Smarter Apps with LLMs |   
| **One-sentence pitch** | Fill out repetitive, complex forms quickly inside the browser by letting an LLM understand field labels, retrieve the right profile data, and generate user-approved answers while caring about privacy. |   
   
**1 . Problem Statement & Vision**  
**Problem**  
   
 Many workflows still require users to repeatedly type the same information into slightly different forms: job portals, housing applications, grant submissions, investor questionnaires, onboarding forms, compliance forms, and PDF templates. The hard part is understanding which field asks for which information. LLMs make this feasible to use automatically now.  
**Vision**  
Smart Form Filler should behave like a careful assistant, not a blind auto-fill tool. It extracts the form structure, maps fields to a user-controlled profile, asks for missing information, and only writes into the form after user approval.  
**2 . Scope**  
**Must‑have (MVP):**  
- Chrome extension with popup UI: User can open the extension on a webpage and trigger form analysis.  
- HTML form detection: Extract input fields, labels, placeholders, select options, textareas, checkboxes and nearby context  
- profile store: Users can import or edit a profile as JSON, for example personal details, company details, CV snippets, standard disclosures.  
- LLM-assisted field mapping: For each field, produce a suggested value  
- User approval before insertion: It should fill only after the user reviews and accepts suggestions.  
**Nice‑to‑have features:**  
- PDF AcroForm support: Parse fillable PDFs and generate suggested field values. Editing or export can be handled with a library or as a separate flow.  
- Knowledge-base document upload: Import CVs and supporting documents, initially PDF and `.docx`, extract their content locally where possible, and convert relevant information into structured profile facts with source provenance.  
- Setup assistant: Convert free-form profile text, a CV, or uploaded documents into structured JSON sections and ask follow-up questions for missing essentials.  
- Improved setup assistant UI: Provide a clear multi-step flow, document preview, extracted-fact review, missing-information prompts, and a final profile confirmation screen.  
- Progressive popup/side-panel UX: Show only the actions relevant to the current state, use clear status indicators and toggles, and modernize layout, spacing, colors, and accessibility.  
- Learning loop: Use corrections to improve future mapping of similar field labels.  
- Encrypted vault: Encrypt the local profile and uploaded knowledge-base data, unlocked by a password for each session. The encryption key must not be stored persistently beside the encrypted data.  
- Multilingual support: Map German/English field labels and produce answers in the form language.  
**Stretch goals**:  
- Local LLM mode through Ollama, llama.cpp, or a similar runtime for better privacy.  
**Explicitly out of scope:**  
- Only Chrome v3 extension (no firefox)  
- No support for file uploads inside forms  
- Scanned non-fillable PDFs forms  
**3 . User Stories**  
| | |  
|-|-|  
|   | ***User Story*** |   
| *1* | As a job applicant, I want the extension to fill common application fields so that I can apply faster across multiple portals. |   
| *2* | As a startup founder, I want the system to generate short company descriptions under character limits so that I can reuse my company profile in investor questionnaires. |   
| *3* | As a housing applicant, I want personal and employment data filled into repetitive forms so that I can respond quickly to listing portals. |   
   
**4 . System Overview**  
   
 Figure 1: System overview of browser extension  
**Main components**  
| | | |  
|-|-|-|  
| **Object/Component** | **Task** | **Notes** |   
| Browser extension pop up UI | First entry for the user after clicking on it. Starts analysis, displays insertion suggestions and lets the user select/reject values. | React or prior Typescript UI. |   
| Content script | Runs in the active page, extracts form tree and writes approved values into DOM fields | DOM API checking |   
| Background service worker | Coordination of requests between popup, content script, local vault and LLM backend |   |   
| Setup Assistant | Parse data into proper JSON format for the knowledgebase | Separate script at the beginning |   
| Profile vault (knowledgebase) | Stores profile | JSON, encryption |   
| Mapping script | Combines field metadata and knowledgebase and calls LLM for structured JSON output | JSON format needs to be strict |   
| LLM connector | Abstracts cloud API or local LLM calls | Privacy/performance trade-offs should be explicitly stated and pluggable |   
| Document ingestion pipeline | Parses uploaded PDF and `.docx` files, extracts text, proposes structured profile facts and stores source references | Prefer local parsing for sensitive documents; require user confirmation before facts become active |   
| Retrieval layer | Selects only profile facts or document chunks relevant to the current form fields | Use deterministic mapping first, then lexical/semantic retrieval, then LLM fallback |   
| PDF module | AcroForm Parsing and Mapping to HTML fields | Nice-to-have with priority |   
   
**5. Tech Stack & External Service**  
**Front-End:**  
   
 WXT + React.js + TypeScript  
WXT (Vite based)  
   
 - Browser extension framework used to structure and build the Chrome extension  
   
 - Handles Manifest V3 setup, extension entry points and development/build workflow  
   
 - Makes it easier to manage popup, content script and background service worker  
React.js + TypeScript  
   
 - Used for the popup UI of the browser extension  
   
 - Shows detected form fields and suggested values  
   
 - Allows the user to approve, edit or reject suggestions  
Chrome Extension Manifest V3  
   
 - Technical standard for the Chrome extension  
   
 - Defines popup, permissions, content script and background service worker  
   
 - MVP focuses only on Chrome  
Tailwind CSS  
   
 - Used for simple and clean UI styling  
**Browser Extension Logic:**  
   
 TypeScript Content Script + Background Service Worker  
Content script  
   
 - Runs on the active webpage  
   
 - Extracts form fields, labels, placeholders, options and nearby context  
   
 - Inserts approved values into the form  
Background service worker

- Coordinates popup, content script, encrypted storage, permissions, and direct provider communication

**Provider boundary:**

- Users supply credentials for OpenAI, Anthropic, or Mistral; Ollama is keyless by default
- The service worker calls the selected provider directly through a provider adapter
- Persistent credentials are encrypted locally and never sent through an application backend
**Profile Store / Knowledge Base:**  
   
 Local JSON profile storage  
JSON profile  
   
 - Stores personal data, company data, CV snippets and standard answers  
   
 - Easy to edit and use for LLM prompts  
Chrome local storage for MVP (indexedDB for later)  
Encrypted vault  
   
 - Encrypts the profile with a user password  
   
 - Improves privacy  
**LLM-API:**  
   
 OpenAI/Anthropic API  
Field mapping  
   
 - Maps form labels to the correct profile entries  
Text generation  
   
 - Generates short answers for free-text fields  
   
 - Can respect character limits and language requirements  
   
 Structured output  
   
 - LLM should return strict JSON  
   
 - Makes validation and insertion safer  
Privacy consideration  
   
 - Cloud mode sends selected profile data to an external API  
   
 - Local LLM mode might be added as a stretch goal  
**Validation & Data Schemas:**  
   
 Zod or TypeScript interfaces for schemas  
   
 - Ensures that e.g. the LLM output is valid before inserting anything into the form  
**PDF Module:**  
   
 pdf-lib  
   
 Supports fillable AcroForm PDF forms  
**Testing & Development Tools:**  
   
 Vitest (for isolated functions), Playwright (to simulate chromium browser), GitHub Repo for version control  
**6 . Project Plan & Timeline**  
| | | | |  
|-|-|-|-|  
| **Week** | **Milestone** | **Owner** | **Delivarable** |   
| 1 | Repo, CI/CD | Team | URL, README |   
| 2 | Architecture Guideline | Team | Flowcharts, Code |   
| 3,4 | Demo Browser Extension (Backend) | Benedikt | Code |   
| 3,4 | Demo Browser Extension (Frontend) | Alireza | Code |   
| 5 | Deployment | Benedikt | Applikation |   
| 6 | Test | Alireza | Test results |   
| 7 | Deployment and Test Cycles for nice-to-have and stretch-features | Team | Feature |   
| 8 | Buffer |   |   |   
| 9-10 | Deployment and Test Cycles for nice-to-have and stretch-features | Team | Feature |   
| 11 | Final application | Team | Alpha/Beta Version maybe available via Appstore |   
| 12 | Final presentation | Team | Slide deck |   
   
**7 . Roles & Responsibilities**  
| **Area** | **Owner** | **Key duties** |  
|-|-|-|  
| Product scope, prioritization and integration | Team | Agree on milestones, acceptance criteria, demo flow and integration decisions. |  
| Document ingestion and setup assistant | Alireza | PDF and possible `.docx` upload, parsing integration, setup-assistant UI, layout, accessibility and document-review flow. |  
| Extension architecture and form-filling engine | Benedikt | Assess and improve the current architecture, implement dropdown and checkbox support, optimize field extraction/mapping/filling, and maintain OpenAI/Ollama integration. |  
| Popup and interaction UX | Benedikt | Modernize the extension UI, colors and layout; apply progressive disclosure so only currently relevant actions, buttons and toggles are shown. |  
| Privacy and encrypted local vault | Benedikt | Design encryption, session unlocking, key lifecycle and storage boundaries; document the threat model and limitations. |  
| Testing and evaluation | Team | Unit tests, integration tests, manual Chromium tests, accuracy/latency evaluation and final demo validation. |  
  
**8 . Risk Register**  
**Risk** **Probability** **Impact** **Mitigation**  
   
 API limitslowHighCaching, sparser requests  
   
 PDF parsing errorsHighMediumFallback to OCR, log fails  
   
 OverlapMediumHighBuffer  
**9 . Evaluation & Demo Plan**  
- Success metrics - answer accuracy @ Top‑1, latency ≤ 5 s  
- Demo script - step‑by‑step flow to show during final presentation.  
- Backup video for demo

**10. Current State and Feature Backlog — 2026-07-12**  

**Manually confirmed as working:**  
- Basic browser-extension flow and popup interaction.  
- Extraction and filling of basic HTML text fields.  
- User profiles stored in Chrome storage.  
- LLM connectors for OpenAI and Ollama.  
- Suggested values returned in a structured form and presented for user approval.  

**Confirmed incomplete:**  
- Native dropdown/select extraction and filling.  
- Checkbox extraction and filling.  

**Status to verify in the code before classifying:**  
- Radio-button support.  
- Handling of framework-controlled fields such as React-controlled inputs.  
- Event dispatch and compatibility across `input`, `change`, and custom page logic.  
- Validation coverage for all LLM outputs.  
- Existing automated tests for extraction, mapping and filling.  
- Whether every filling path enforces user approval.  

**Feature ownership and immediate goals:**  

**Alireza:**  
- Add knowledge-base document upload, beginning with PDF and evaluating `.docx`.  
- Build a clearer and more polished setup assistant.  
- Design a setup assistant layout for upload, extraction progress, extracted-data review, missing-data questions and final confirmation.  

**Benedikt:**  
- Redesign the popup/side-panel interaction with a modern, restrained visual system and improved UX.  
- Use progressive disclosure: show only the primary action for the current state, with secondary controls behind settings or toggles.  
- Add dropdown/select and checkbox support without regressing existing text-field behavior.  
- Review the extension architecture and propose a faster, more private and more maintainable mapping pipeline.  
- Evaluate structured retrieval/RAG for profile JSON and uploaded documents.  
- Add encryption with a safe key lifecycle rather than storing plaintext profile data or a reusable encryption key in the same persistent storage area.  

**11. Architecture Review and Recommended Target — July 2026**  

**Current flow:**  
1. The content script extracts HTML form fields.  
2. The extension sends the extracted fields and profile JSON to an LLM.  
3. The LLM returns suggested field values in a schema.  
4. The user reviews and accepts suggestions.  
5. Approved values are inserted into the page.  

This flow is suitable for an MVP, but sending the full profile and all fields for every form can become slower, more expensive and less private as the profile and knowledge base grow. It also asks the LLM to solve mappings that deterministic code can solve more reliably.  

**Recommended target: a hybrid deterministic + retrieval + LLM-fallback architecture.**  

**Stage A — Normalize profile and document knowledge**  
- Keep a canonical structured profile for stable facts such as name, addresses, contact data, employment, education and standard disclosures.  
- Represent each fact with a stable key, value, aliases, sensitivity level, source document and optional confidence.  
- Parse `.docx` content with a browser-compatible parser such as Mammoth, and parse PDF text with PDF.js or a comparable parser. Keep PDF AcroForm handling separate through `pdf-lib`.  
- The setup assistant should propose extracted facts; the user must confirm or edit them before they become active profile data.  
- Keep source provenance so the review UI can show where an answer came from.  

**Stage B — Normalize the form locally**  
- Convert every control into one internal schema containing field ID, type, label, `name`, placeholder, ARIA attributes, nearby text, options, required/disabled state, constraints and a stable field signature.  
- Group related controls, for example radio groups and checkbox groups, before mapping.  
- Remove irrelevant page text and avoid sending raw full-page HTML to an LLM.  

**Stage C — Resolve easy mappings without an LLM**  
- Use exact canonical keys and aliases for common fields such as first name, surname, email, telephone and postal code.  
- Use deterministic type and constraint checks, for example email values only for email fields and valid option matching for selects.  
- Cache accepted mappings by a privacy-safe field signature so repeated or similar forms require less model work.  

**Stage D — Retrieve candidates for ambiguous fields**  
- For a small JSON profile, full vector-database RAG is usually unnecessary. Flatten the profile into typed facts and use exact/alias matching first.  
- For larger uploaded documents, add hybrid retrieval: keyword/alias search plus optional embeddings over document chunks or profile facts.  
- Retrieve only a small top-k set of relevant facts and send those candidates to the LLM instead of sending the full profile.  
- Treat uploaded documents as a secondary evidence source. Prefer confirmed canonical profile facts when both exist.  

**Stage E — Use the LLM only where it adds value**  
- Send unresolved or open-ended fields, the relevant retrieved facts, field constraints and the required output schema.  
- Batch related unresolved fields into one request rather than making one request per field.  
- Require strict JSON-Schema output with a value, confidence, evidence/source IDs and an optional reason for uncertainty.  
- Generate free-text answers only for fields that genuinely require synthesis, character limits or language adaptation.  
- Never allow the LLM to submit a form or bypass the review step.  

**Stage F — Review, apply and learn**  
- Group suggestions by confidence and show low-confidence or sensitive fields prominently.  
- Let the user accept, edit or reject individual suggestions and provide “accept safe suggestions” only for high-confidence, non-sensitive fields.  
- Apply values through field-type-specific adapters for text, select, checkbox and radio controls.  
- Record corrections as local aliases or mapping rules after explicit user consent. Do not silently train on sensitive data.  

**Why this is preferable to sending the full JSON profile every time:**  
- Lower token usage and latency.  
- Less personal data sent to cloud providers.  
- More deterministic behavior for common fields.  
- Better provenance and explainability.  
- Easier testing because retrieval, mapping and filling can be evaluated independently.  
- Graceful local-only operation when Ollama is selected.  

**OpenAI-specific optimization for cloud mode:**  
- Use Structured Outputs rather than plain JSON mode so mapping results follow the defined JSON Schema.  
- Put stable instructions and schemas at the beginning of the prompt and variable form/profile context later to improve prompt-cache reuse.  
- Limit file-search or retrieval results to the smallest useful top-k because fewer results reduce tokens and latency, while monitoring any accuracy trade-off.  

**12. UI/UX Direction**  

The extension UI should operate as a small state machine rather than showing every control simultaneously.  

| **State** | **Primary UI** | **Secondary options** |  
|-|-|-|  
| First use | “Set up profile” and “Import document” | Privacy explanation and provider selection |  
| Ready on a page | “Analyze form” | Profile selector, local/cloud mode toggle |  
| Analyzing | Progress and cancel action | Compact technical details |  
| Review | Suggested values grouped by confidence | Edit, reject, source/provenance view |  
| Ready to fill | “Fill approved fields” | Select all safe suggestions |  
| Completed | Filled-field summary | Undo where technically possible, report issue |  
| Error/offline | Clear error and recovery action | Logs/details behind disclosure |  

**Visual and interaction principles:**  
- Modern but restrained design: clear typography, consistent spacing, subtle elevation, a small semantic color palette and accessible contrast.  
- One dominant action per state.  
- Hide provider/API configuration during routine form filling.  
- Use toggles only for persistent user choices such as local/cloud mode or auto-lock behavior.  
- Show sensitive fields, low confidence and external data transmission clearly before approval.  
- Preserve keyboard navigation, focus visibility and readable status messages.  

**13. Encryption and Key Management**  

Storing an encryption key persistently in the same Chrome storage area as the ciphertext provides little protection against an attacker or compromised extension context that can read both. The preferred design is:  

1. Ask the user for a vault password.  
2. Derive an encryption key with a password-based key derivation function supported by the chosen implementation.  
3. Encrypt profile facts and document data with authenticated encryption such as AES-GCM.  
4. Store only ciphertext, random salt, random IV/nonce, version metadata and integrity-related metadata in persistent storage.  
5. Keep the unlocked key only in memory or a short-lived session storage area, then clear it on browser restart, explicit lock or idle timeout.  
6. Restrict `chrome.storage.local` access to content scripts where possible; route sensitive reads through trusted extension contexts.  
7. Document the threat model: this protects data at rest, but it cannot fully protect against a malicious extension update or a compromised browser process while the vault is unlocked.  

A security review is required before describing the vault as strongly secure. Web Crypto exposes low-level primitives and correct key management is easy to get wrong.  

**14. Product and Architecture Inspirations**  

These are product patterns to study based on public descriptions, not verified internal architectures and not endorsements:  

- **Simplify Copilot:** structured applicant profile, broad ATS coverage, autofill plus generated application material and a workflow-oriented product surface.  
- **Magical:** low-friction invocation, reusable snippets/templates, and autofill directly in the user’s current application rather than a separate complex workflow builder.  
- **Form Autofill AI:** profile/document setup followed by one-click autofill and user review before submission.  
- **JobFill (open source):** generic DOM analysis, multiple profiles, local PDF parsing, OpenAI-compatible/BYOK endpoints and explicit treatment of sensitive demographic fields. Its implementation should be reviewed critically rather than copied.  

**15. Proposed Implementation Order**  

**Phase 1 — Reliability and observability**  
- Document the current architecture and message flow.  
- Add normalized field schemas, dropdown support and checkbox support.  
- Add focused tests for extraction, mapping validation and field application.  
- Add safe diagnostic logging without profile values.  

**Phase 2 — UX redesign**  
- Implement the state-based popup/side-panel flow.  
- Add confidence, provenance and sensitive-data indicators.  
- Improve accessibility and visual consistency.  

**Phase 3 — Document ingestion and setup assistant**  
- Add PDF upload and extraction.  
- Evaluate and add `.docx` upload.  
- Add extracted-fact review and profile merging.  

**Phase 4 — Hybrid retrieval and performance optimization**  
- Add canonical aliases and deterministic mappings.  
- Add optional retrieval over document facts/chunks.  
- Send only unresolved fields and top candidate facts to the LLM.  
- Add mapping cache and measure accuracy, latency and token usage.  

**Phase 5 — Encrypted vault**  
- Implement password-derived session unlocking and authenticated encryption.  
- Add lock, unlock, password-change and recovery behavior.  
- Perform a security review and document limitations.  

**Phase 6 — Evaluation**  
- Test against a fixed suite of representative HTML forms.  
- Measure top-1 mapping accuracy, percentage of fields resolved without an LLM, latency, token usage, correction rate and user approval time.  
- Compare the current full-profile prompt architecture against the hybrid architecture.  

**16. Research and Technical References — accessed 2026-07-12**  

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)  
- [OpenAI File Search](https://developers.openai.com/api/docs/guides/tools-file-search)  
- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)  
- [Chrome Extension Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)  
- [MDN SubtleCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)  
- [Mammoth.js — `.docx` conversion](https://github.com/mwilliamson/mammoth.js/)  
- [Mozilla PDF.js](https://github.com/mozilla/pdf.js/)  
- [pdf-lib AcroForm API](https://pdf-lib.js.org/docs/api/classes/pdfform)  
- [Simplify Copilot — Chrome Web Store](https://chromewebstore.google.com/detail/simplify-copilot-autofill/pbanhockgagggenencehbnadejlgchfc)  
- [Magical — Chrome Web Store](https://chromewebstore.google.com/detail/magical-text-expander-aut/iibninhmiggehlcdolcilmhacighjamp)  
- [Form Autofill AI — Chrome Web Store](https://chromewebstore.google.com/detail/form-autofill-ai/blmmfpnaicaokpfkhfoojnooiblcbgbj)  
- [JobFill — open-source browser autofill project](https://github.com/Galaxy-GunPowder/Browser-Auto-Fill)  
