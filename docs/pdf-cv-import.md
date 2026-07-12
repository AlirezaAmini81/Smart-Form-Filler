# PDF document import

## User flow

1. Open **Settings** in the Smart Form Filler popup.
2. In **Import document from PDF**, select a text-based PDF that is 8 MB or smaller.
3. The extension reads the document locally and populates editable fields.
4. For now, CV/resume files are parsed best. Other documents can still be selected, but the parser only extracts information that matches the currently supported profile/CV patterns.
5. Review or edit every imported field.
6. Choose an Account ID and press **Save to Knowledge Base**.

The original PDF is not uploaded or stored. Only the reviewed profile entries are saved in Chrome local extension storage. Imported entries keep source information in the knowledge base, for example `Imported from jane-doe-cv.pdf`.

Parsed candidates are validated with Zod before they enter the review form. Pressing **Save to Knowledge Base** is the confirmation boundary; no imported value is persisted when a file is selected. Saving uses the canonical `ProfileRepository`. Existing entries with the same profile ID and label are replaced, while unrelated entries and profiles are preserved.

## Supported PDFs

- Text-based PDFs with selectable text.
- Maximum file size: 8 MB.
- Maximum pages read: 12.
- Maximum extracted text: 50,000 characters.

Scanned/image-only PDF files are intentionally rejected with a clear error because OCR is not part of this feature yet.

DOCX files are not supported yet.

## Current parsing behavior

The import menu is intentionally generic, but the current parser is optimized for CV/resume documents. It tries to detect:

- Basic profile fields: full name, professional title, email, phone, and city/location.
- Optional details entered by the user: street address, postal code, and age.
- Additional entries: summary, skills, work experience, education, certifications, projects, achievements, languages, public profile links, and similar CV sections.

Address details such as street and postal code are not required and are not strongly inferred from a CV. Users can add them manually in the optional section.

## Main files

- `apps/extension/src/features/import/pdfTextExtractor.ts`: local PDF.js extraction and validation.
- `apps/extension/src/features/import/pdfCvParser.ts`: deterministic document/CV parser.
- `apps/extension/src/features/import/pdfFileValidation.ts`: supported-type and size checks.
- `apps/extension/src/setup/SetupAssistant.tsx`: import/review/save UI.
- `apps/extension/src/setup/setupProfileService.ts`: validated confirmation and canonical persistence boundary.
- `tests/unit/pdfCvParser.test.ts`, `pdfImportValidation.test.ts`, and `setupProfileService.test.ts`: focused parser and integration tests.

The implementation uses pinned `pdfjs-dist` 6.1.200. Extracted plaintext exists temporarily in memory during parsing and is released after the import handler completes; it is not stored separately from user-confirmed profile entries.
