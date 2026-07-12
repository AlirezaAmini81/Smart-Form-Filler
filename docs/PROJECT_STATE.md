# Smart AI Form Filler — Compressed Project State

Updated: 2026-07-12

Status labels: **Verified in code** = implementation inspected; **Verified by command** = current command passed; **Manually reported** = team runtime report; **Planned only** = requirement without implementation; **Unknown** = not established by code, tests, or report.

## Product summary

- **Verified in code:** Chrome Manifest V3 extension that extracts webpage form controls, retrieves profile facts, generates suggestions locally or by calling a user-selected provider directly from the service worker, displays a review overlay, and fills selected values. Evidence: `apps/extension/public/manifest.json`, `apps/extension/src/{popup,background,content}`.
- **Verified in code:** The product does not submit forms; filling is limited to individual DOM controls. Evidence: `apps/extension/src/lib/dom/fillFormFields.ts`.

## Current stack

- **Verified in code:** TypeScript 6 (strict), React 19, Vite 8, Tailwind CSS 4, Chrome MV3, Zod 4, Vitest 4 with `happy-dom`, and local PDF.js extraction. Provider SDKs and the former Node/Express proxy dependencies are absent. Evidence: `package.json`, `tsconfig.json`, `vitest.config.ts`.
- **Verified in code:** PDF.js (`pdfjs-dist` 6.1.200) is installed for local PDF text extraction. The plan also names WXT, Playwright, and Anthropic, but none is configured or installed. Evidence: `package.json`, `apps/extension/src/features/import/pdfTextExtractor.ts`.

## Architecture and data flow

1. **Verified in code:** Popup queries the active tab and requests extraction from the content script. Evidence: `apps/extension/src/popup/App.tsx`, `apps/extension/src/content/index.ts`.
2. **Verified in code:** Content script extracts visible inputs, textareas, and selects, including option text and checkbox/radio state. Evidence: `apps/extension/src/lib/dom/extractFormFields.ts`.
3. **Verified in code:** Popup sends normalized fields, active profile, provider/privacy choice, and an explicit suggestion mode to the service worker. Evidence: `apps/extension/src/lib/messaging/types.ts`, `apps/extension/src/background/index.ts`.
4. **Verified in code and by focused tests:** Suggestion orchestration supports full-context LLM, descriptor/ID-only LLM with local value hydration, and deterministic-only execution. Exact matches bypass the provider in ID-only mode; deterministic-only never constructs or calls a provider. Evidence: `suggestionEngine.ts`, `suggestionMapping.ts`, `promptBuilder.ts`, `suggestionModes.test.ts`.
5. **Verified in code:** The service worker calls OpenAI, Anthropic, Mistral, or Ollama directly through provider-specific typed fetch adapters. API keys are user-supplied and never pass through an application backend. Evidence: `apps/extension/src/background/index.ts`, `apps/extension/src/lib/llm/*Provider.ts`.
6. **Verified in code and by focused tests:** Provider JSON is Zod-validated and mapped back to extracted controls through opaque, in-memory field locators. The review overlay fills only selected answers. Original ID/name/label lookup remains as a compatibility fallback. Evidence: `responseParser.ts`, `suggestionSchemas.ts`, `fieldLocatorRegistry.ts`, `formFields.test.ts`, `content/index.ts`.

## Confirmed working features

- **Verified in code and by focused tests:** A full-tab React settings application is built at `settings.html`, registered as the MV3 options page, and opened by the popup through one section-aware helper. Hash navigation provides Overview, Setup, Profiles, Documents, Providers, Encryption, and General sections, reload persistence, responsive layout, active-section semantics, and arrow-key navigation. The former `setup.html` entry renders the same application for compatibility. Evidence: `src/settings/*`, `features/settings/{openSettingsPage,settingsNavigation}.ts`, `settingsNavigation.test.ts`.
- **Verified in code and by focused tests:** One Zod-validated `saff.settings.v1` record persists active profile, resumable setup state, provider configuration, suggestion mode, and confidence threshold. A newly opened popup loads this state and clears stale suggestions when the profile, provider, or mode changes. Evidence: `features/settings/{settingsTypes,settingsRepository}.ts`, `popup/App.tsx`, `settingsRepository.test.ts`.
- **Verified in code and by focused tests:** The browser-action popup is a compact current-page workflow with setup, locked-vault, missing-profile, unavailable-provider, ready, analyzing, no-fields, suggestion-summary, review, filling, completion, and categorized error states. Setup, profile editing, documents, provider configuration, encryption, and general settings remain in the full-page application and are opened through `openSettingsPage`. Evidence: `popup/{App,popupState}.ts*`, `popupState.test.ts`.
- **Verified in code and by focused tests:** The popup reads settings and profiles only through canonical repositories, refreshes while open on local/session storage changes, identifies the active profile, and permits compact switching when multiple profiles are available. A profile/provider/mode change clears analysis; fill additionally verifies the current tab, URL, and profile against the analysis snapshot. Evidence: `popup/{App,popupState}.ts*`, `popupState.test.ts`.
- **Verified in code and by focused tests:** Generated values begin undecided, review supports explicit approve/reject and editable values (including checkbox/select representations), and only approved non-empty values cross the existing content-script fill boundary. Completion separates filled, unattempted/skipped, and insertion-failed counts; no form submission occurs. Evidence: `popup/{App,popupState}.ts*`, `fillFormFields.ts`, `popupState.test.ts`.
- **Verified in code and by focused tests:** The popup always shows a compact profile selector when unlocked profile metadata is available, offers one-click approval of all fillable suggestions, and keeps unresolved suggestions unapproved. The summary shows only fillable and unresolved counts; confidence, warnings, and sensitivity remain available per item during individual review. Evidence: `popup/{App,popupState}.ts*`, `popupState.test.ts`.
- **Verified in code and by focused tests:** Full profile CRUD uses `ProfileRepository` and `StoredProfileDataSchema`: create, rename, duplicate, active selection, stable-ID entry create/edit/delete, and confirmed profile deletion preserve unrelated profiles and settings. Locked vaults hide profile content and disable editing/import. Evidence: `profileManagementService.ts`, `SettingsApp.tsx`, `profileManagementService.test.ts`.
- **Verified in code and by focused tests:** The Documents section targets a profile, parses PDFs locally, exposes editable/removable candidates, requires explicit confirmation, and applies keep/replace/alternative conflicts in one canonical write. Cancellation and invalid confirmation do not persist. Evidence: `documentImportService.ts`, `SettingsApp.tsx`, `documentImportService.test.ts`.

- **Manually reported:** Basic HTML text-field extraction and text-field filling work; matching implementations exist in `extractFormFields.ts` and `fillFormFields.ts`.
- **Verified in code and by focused tests:** Profiles persist through one validated repository and canonical Chrome storage record. No legacy storage compatibility is maintained because the application is not public. Evidence: `profileRepository.ts`, `profileRepository.test.ts`, `setup/SetupAssistant.tsx`.
- **Verified in code and by focused tests:** The setup assistant imports text-based PDF CVs locally, validates file constraints and parsed candidates, exposes extracted values for editing, and persists only after the user presses save. Imported entries use the canonical profile repository and are available to the existing knowledge retriever. Evidence: `features/import/*`, `setupProfileService.ts`, `pdfImportValidation.test.ts`, `setupProfileService.test.ts`.
- **Manually reported:** OpenAI and Ollama connectors exist and suggestions are reviewed before filling in normal UI flows. Evidence: `lib/llm/provider.ts`, `providerRegistry.ts`, `popup/App.tsx`, `content/index.ts`.
- **Verified by command:** The extension compiles, all current unit tests pass, and a production extension bundle is generated.
- **Verified by focused tests:** Text inputs, textareas, checkboxes, radio groups, and native selects are extracted and filled; disabled fields are excluded/rejected; rejected suggestions are not filled; filling dispatches bubbling `input` followed by `change` and uses native value/checked setters. Evidence: `tests/unit/formFields.test.ts`.

## Partially implemented features

- **Verified in code:** Setup is a resumable seven-stage flow inside settings and links to canonical profile, document, provider, and encryption controls. Confirmed changes persist; passwords and unconfirmed candidates remain transient component state.
- **Verified in code and by focused tests:** One clean provider architecture supports OpenAI, Anthropic Claude, Mistral, and Ollama. The canonical settings schema stores only selected provider, models, and the loopback Ollama endpoint. Settings provide credential save/replace/delete, session or encrypted persistence, masking, scoped permission requests, and connection testing without profile/document data.

- **Verified in code:** Approval is enforced at the fill boundary with an explicit `approved` flag, in addition to selection in the popup and overlay. Content-script messages still use TypeScript assertions rather than a Zod message schema. Evidence: `fillFormFields.ts`, `content/index.ts`, `popup/App.tsx`.
- **Verified in code:** Profile setup supports fixed/custom plaintext facts, simple line parsing, and deterministic PDF CV import. It does not support LLM-assisted setup, OCR, DOCX, or general-purpose document interpretation. Evidence: `setup/SetupAssistant.tsx`, `features/import/*`.
- **Verified in code:** Lexical/semantic scores guide deterministic matching but no longer gate LLM visibility: both LLM modes receive every policy-eligible entry. Dense embedding retrieval is not implemented; it is unnecessary for the current small profile but may be needed with large knowledge bases. Evidence: `knowledgeRetriever.ts`, `suggestionEngine.ts`.
- **Verified in code:** External LLM output and stored profile data are strictly Zod-validated; content/background messages still use TypeScript assertions. Evidence: `responseParser.ts`, `knowledgeTypes.ts`, `profileRepository.ts`, `background/index.ts`, `content/index.ts`.

## German contact and native-select matching

- **Verified in code and by focused tests:** Contact matching uses shared Unicode/punctuation/required-marker normalization and semantic aliases. Supported phone terms include `Telefon`, `Telefonnummer`, `Mobil`, `Mobilnummer`, `Phone`, `Phone number`, and `Telephone`; email terms include `E-Mail`, `Email`, `E-Mail-Adresse`, `Email address`, and `Mail`.
- **Diagnosed:** `Telefon` previously had no German token shared with the phone entry. `E-Mail` depended on incidental punctuation/token overlap instead of a canonical contact match. Neither value was rejected by input validation or insertion. Required markers and separate helper text are not the cause when explicit labels are present.
- **Diagnosed:** `Anrede` matched the salutation entry (`Herr`) before considering its gender-valued options. Select resolution also returned unsupported values and used unsafe partial text matching. It now infers gender from a multi-option gender set, prefers a compatible gender entry, and resolves only normalized option text/value or safe gender equivalents (`male`/`männlich`, `female`/`weiblich`, `diverse`/`non-binary`/`divers`).
- **Verified in code and by focused tests:** Native selects use the actual option value after matching normalized visible text or value, preserve opaque locators through minimization, dispatch bubbling `input` and `change`, and reject unsupported options. Hidden native selects are supported when a visible, associated ARIA combobox proxy exists (including common jQuery UI selectmenu markup); the native control remains the submitted source of truth and known selectmenu text nodes are synchronized. Standalone custom comboboxes without a backing native select remain unsupported.
- **Verified in code and by focused tests:** Gender-valued selects accept compatible salutation facts (`Mr.`/`Herr`, `Ms`/`Mrs`/`Frau`, `Mx`) when no explicit gender fact exists. Explicit gender facts rank above potentially conflicting salutations. A Cornelsen-shaped hidden `Anrede` select resolves `Mr.` to visible option `Männlich`, whose native value is then filled as `GENDER_MALE`.
- **Verified by build:** The manifest-declared content script is emitted as a self-contained classic script. The build fails if `assets/content.js` gains static or dynamic module imports, which Chrome MV3 content scripts cannot execute.
- **Privacy behavior:** Sensitive snippets remain eligible for deterministic local suggestions and require approval before insertion. Cloud opt-in retains sensitive snippets with a warning, secret snippets remain blocked, and prompt-injection policy still removes sensitive/secret snippets. Runtime logs contain message types/counts, not complete field answers or profile values.

## Suggestion modes

| Mode | Provider payload | Resolution behavior |
|---|---|---|
| Full context (LLM) | All policy-eligible form context and knowledge values | Provider may cite and combine multiple entries or normalize formats; validated provider results take precedence, with deterministic fallback |
| Private mapping (LLM) | Unresolved field descriptors and knowledge IDs/labels/tags/aliases; profile values, summaries, source labels, profile name, page URL/title, and current field values are omitted | Provider selects one knowledge ID; the extension ignores provider values and hydrates the stored value locally; exact matches bypass the provider |
| Direct matching only | Nothing | Local normalized/semantic/option-compatible matches only; provider registry is not invoked |

- **Verified in code and by focused tests:** Unknown provider entry IDs are discarded, non-null full-context values without known provenance are rejected, ID-only multi-entry composition abstains, source IDs are derived locally, and every result still requires user approval.
- **Verified in code:** Full-context mode is the only mode that supports multi-entry composition and model-driven formatting such as `mm/dd/yyyy` to `dd/mm/yyyy`. ID-only intentionally supports one-to-one direct copies; deterministic mode supports only implemented local derivations.
- **Verified in code and by focused tests:** The engine returns one ordered review record per extracted field. The page overlay separates fillable suggestions from grey, non-selectable detected fields without a reliable match; unmatched fields remain visible regardless of the confidence filter. File inputs are detected and shown in the unmatched section but are never sent for suggestions or filled programmatically.

## Confirmed missing features

- **Verified in code:** A password-based encrypted profile vault, session key lifecycle, and UI for migration/enable, unlock, lock, and password change exist. DOCX ingestion, original-document preview, correction-learning cache, multilingual layer, OCR, and PDF form support remain absent. PDF import extracts selectable CV text but does not render or retain the source document. Evidence: `profileVault*.ts`, `settings/SettingsApp.tsx`, `features/import/*`, `docs/PROJECT_PLAN.md`.
- **Verified in code:** OpenAI and Mistral request JSON output, Anthropic extracts Messages API text blocks, and Ollama requests JSON format. Every result then crosses the same strict Zod validation boundary before mapping.
- **Verified in code:** Storage, settings/navigation services, profile management, document merge, and DOM behavior have focused unit coverage; messaging, providers, API routes, rendered settings/popup UI, and browser integration do not. Evidence: `tests/unit/`.

## Profile storage architecture

- **Canonical schema:** `StoredProfileDataSchema` in `apps/extension/src/features/suggestions/knowledgeTypes.ts`. It strictly validates version/timestamp, unique profile metadata (`id`, `name`, `sensitivity`), unique knowledge entries, sensitivity, and profile-entry references.
- **Canonical keys:** uninitialized users remain compatible with plaintext `saff.profiles.v1`; initialized vaults persist only the v1 AES-GCM envelope at `saff.profileVault.v1` in `chrome.storage.local`.
- **Canonical boundary:** `ProfileRepository` delegates initialized reads/writes to `ProfileVault`; popup, setup assistant, and the storage-backed knowledge retriever continue using the repository. The vault exposes explicit initialize, migrate, unlock, lock, read/write, password-change, status, and clear operations.
- **Crypto and lifecycle:** AES-256-GCM uses fresh 12-byte IVs; PBKDF2-SHA-256 uses a fresh 16-byte salt and configurable 310,000-iteration default. Envelope metadata is authenticated. The exported AES key is retained only in `chrome.storage.session`, restricted to trusted extension contexts where supported, and removed on lock. Browser restart, extension reload, disable, or session-storage reset locks the vault.
- **Migration:** explicit-password migration detects canonical plaintext, `saff.knowledgeBase.v1`, and legacy account-ID records; validates, encrypts, reads/decrypts/verifies, then removes plaintext. Malformed/conflicting data is retained and recorded as migration failure. Existing encrypted vaults are skipped idempotently.
- **Focused tests:** vault initialization, authentication, tamper detection, lock/session reset, canonical and legacy migration, failed-write preservation, invalid data/version handling, password change, encrypted repository routing, and absence of persistent plaintext are covered in `tests/unit/profileVault.test.ts` and `profileRepository.test.ts`.
- **Remaining risks:** no password setup/unlock/change UI is implemented, so the service boundary must be integrated into popup/setup before users can enable encryption. An unlocked trusted extension context can access decrypted data; password strength governs resistance to offline guessing; no browser-level storage test exists. Demo fallback data remains compiled into the extension but is not persisted by the vault.

## PDF document import

- **Parsing path:** files must be PDF by MIME type or extension, non-empty, and at most 8 MB. PDF.js reads at most 12 pages and 50,000 characters locally; malformed, protected, scanned, and image-only documents are rejected. The original bytes and extracted plaintext are not persisted or logged.
- **Review and persistence:** deterministic CV parsing produces a Zod-validated editable candidate. Import updates the setup form only; pressing `Save to Knowledge Base` is the explicit confirmation boundary. `saveReviewedProfile` validates the reviewed values again and writes through `ProfileRepository` to plaintext storage before initialization or the encrypted vault while unlocked.
- **Merge behavior:** saving replaces entries with the same profile ID and label while preserving unrelated profiles and unrelated labels for the same profile. Import failures and validation failures do not write storage.
- **Supported content:** PDF only. Contact fields, professional title, common CV sections, and public profile links are recognized. DOCX, OCR, original-document preview, arbitrary document schemas, and browser-level import tests remain unsupported.

## Unverified assumptions

- **Unknown:** Real-site compatibility, shadow DOM/iframe/custom widgets, framework-controlled inputs beyond native-setter/event behavior, and option matching across localized sites have no browser evidence.
- **Unknown:** Real OpenAI, Anthropic, Mistral, and Ollama end-to-end success, latency, mapping accuracy, and Chrome installation behavior were not manually exercised.
- **Unknown:** The manual claim that checkbox/select support is absent may mean it is known broken at runtime; code alone cannot resolve that discrepancy.

## Important files and responsibilities

| Status | Path | Responsibility |
|---|---|---|
| Verified in code | `apps/extension/public/manifest.json`, `vite.config.ts` | MV3 permissions, entries, bundle |
| Verified in code | `popup/App.tsx`, `setup/SetupAssistant.tsx`, `setupProfileService.ts`, `profileRepository.ts`, `knowledgeTypes.ts` | workflow/review, profile editing/import, canonical validated storage |
| Verified in code | `features/import/*` | PDF validation, local text extraction, validated deterministic CV parsing |
| Verified in code | `content/index.ts`, `lib/dom/*` | page messages, extraction, review overlay, filling |
| Verified in code | `background/index.ts`, `features/suggestions/*` | orchestration, retrieval, policy, mapping/provenance |
| Verified in code | `lib/llm/*`, `lib/privacy/*` | provider contract, prompts, validation, privacy filters |
| Verified in code | `features/providers/providerCredentialStore.ts`, `lib/llm/*` | encrypted/session credentials, catalog, direct adapters, registry, response validation |
| Verified in code | `packages/shared/src/schemas.ts` | shared form/suggestion Zod schemas |
| Verified in code | `tests/unit/*` | deterministic storage, privacy, suggestion, and form-field tests |

## Settings application architecture

- `settings.html` and compatibility entry `setup.html` load the same React application; the URL hash owns navigation state and no router or state-management library was added.
- `saff.settings.v1` is the only shared settings record. Profiles remain exclusively in `ProfileRepository`, with the vault as its encryption boundary.
- Active-profile changes are persisted and clear popup suggestions/review state. The next analysis retrieves only the selected profile.
- Source identity is recorded on entries and profile metadata. Source removal is not offered because the model cannot safely distinguish independently edited imported entries from untouched imports.

## Test and build status

- **Verified by command:** `npm run typecheck` passed (2026-07-12).
- **Verified by command:** `npm test` passed: 21 files, 103 tests (2026-07-12), including popup prerequisite routing, loading/duplicate guards, one-click approval, suggestion summaries, explicit approval/rejection, fill eligibility, stale analysis, error repair navigation, salutation-to-gender select resolution, PDF validation/parsing, reviewed import confirmation, suggestion modes, German contact/native-select behavior, and locators.
- **Verified by command:** `npm run build` passed; Vite emitted popup, setup, content, and background artifacts (2026-07-12).

## Architecture risks or unnecessary complexity

- **Verified in code and by focused tests:** Normalized suggestion IDs no longer determine DOM lookup. Extraction registers each control under an opaque locator, the suggestion pipeline preserves it, and filling resolves the registered element directly without reconstructing a selector. Evidence: `fieldLocatorRegistry.ts`, `suggestionMapping.ts`, `fillFormFields.ts`, `formFields.test.ts`.
- **Verified in code:** Existing plaintext remains usable until explicit password migration; after vault initialization the repository refuses plaintext fallback while locked. Default demo PII remains compiled as fallback. Evidence: `profileRepository.ts`, `profileVault.ts`, `knowledgeDefaults.ts`.
- **Verified in code:** The former `apps/api` OpenAI proxy, proxy routes, server environment keys, proxy URL setting, compatibility reads, and server-only dependencies were deleted. No backend responsibility remained; PDF/document parsing stays local in the extension.

## Direct provider credentials and permissions

- **Canonical settings:** `saff.settings.v1` contains `selectedProvider` and per-provider model configuration; only Ollama has an endpoint. The obsolete proxy/cloud schema is rejected rather than migrated.
- **Persistent credentials:** `saff.providerCredentials.v1` is an AES-256-GCM envelope encrypted with the unlocked profile-vault session key and a fresh 12-byte IV on every write. Keys are never stored in settings, sync storage, logs, URLs, or content-script messages. Locking removes session credentials and makes persistent credentials unavailable.
- **Session credentials:** `saff.providerCredentials.session.v1` is restricted to trusted extension contexts and cleared by restart/reload, explicit lock, or deletion. Persistent save while locked reports that encryption must be enabled.
- **Host access:** Cloud origins and loopback Ollama origins are optional host permissions requested from the settings UI. Cloud base URLs are fixed; Ollama rejects non-loopback endpoints, embedded credentials, query strings, and fragments. No broad HTTPS host permission is declared.
- **Dependencies:** `openai`, `express`, `cors`, `dotenv`, `tsx`, and related type packages were removed; no provider SDK was added.
- **Tests:** focused coverage exercises the four-provider registry, direct request endpoints/auth/request shapes/error normalization, common response validation, encrypted/session credential lifecycle, masking/replacement/deletion, and manifest/endpoint permission constraints.
- **Remaining limitations:** automated tests use mocked provider responses; paid-provider/manual browser verification has not been run. Ollama is intentionally restricted to localhost/loopback because broader optional host patterns would overgrant access. Vault password rotation stages encrypted credentials in trusted session storage and re-encrypts them with the new vault key.
- **Verified in code:** `SettingsApp.tsx` and `SetupAssistant.tsx` remain large components. The popup's second deterministic “simulate LLM” path and embedded configuration/debug interfaces were removed; rendered popup/browser integration coverage is still absent.

## Recommended next three implementation tasks

1. **Planned only:** Add browser integration coverage for real-site and framework-controlled form behavior, including DOM replacement after extraction.
2. **Planned only:** Define Zod schemas for messages and centralize approval-to-fill authorization.
3. **Planned only:** Add provider/API integration tests and a multilingual mapping benchmark; introduce optional local embedding candidate generation only when profile size or benchmark results justify it.
