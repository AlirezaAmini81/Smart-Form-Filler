# Documentation files that still need review

The four files included in this bundle are the minimum public-facing changes:

- `README.md`
- `package.json`
- `apps/extension/public/manifest.json`
- `LICENSE` (new)

The following existing documents also contain outdated information and should be revised or clearly marked as historical:

- `docs/architecture.md`
  - Still calls the project "Phase 1".
  - Describes the content script, background worker, vault, setup assistant, and suggestion engine as placeholders.

- `docs/pdf-cv-import.md`
  - Says DOCX is unsupported.
  - Describes the older Setup Assistant flow and file names instead of the current document-import UI.

- `docs/PROJECT_STATE.md`
  - Has contradictory statements about encryption UI and DOCX support.
  - Contains an old test result of 103 tests from July 12, 2026.
  - Should be regenerated from the current source or moved to an archive/history section.

- `docs/privacy-model.md`
  - Uses "Phase 1" terminology.
  - Privacy claims should be checked against the current suggestion engine, particularly the amount of policy-eligible profile context sent to providers.

- `docs/PROJECT_PLAN.md`
  - This may remain as a planning/history document, but implemented features should no longer be described as future work.
  - It references WXT and Playwright although they are not configured in the current package.
  - Consider renaming it to `PROJECT_PLAN_ARCHIVE.md` if it is kept for course documentation.

- `docs/llm-connector.md`
  - Review provider names, model defaults, privacy wording, and any statements about unfinished functionality.
