# Smart Form Filler

Smart Form Filler is a privacy-focused Chrome extension that helps users complete web forms from reusable profile information.

It analyzes supported fields on the current page, generates suggestions through local matching or an optional language model, and lets the user review every value before it is inserted. The extension does not submit forms automatically.

## Features

- Extracts common form fields from webpages
- Matches fields with reusable profile information
- Supports deterministic and LLM-assisted suggestions
- Requires approval before filling any value
- Allows suggestions to be edited or rejected
- Supports multiple profiles
- Protects profile data with an encrypted local vault
- Imports profile information from PDF, DOCX, and TXT files
- Supports OpenAI, Anthropic, Mistral, and Ollama
- Stores API keys temporarily or in the encrypted vault
- Uses native input and change events for modern websites
- Does not require an application-owned backend

## How it works

```text
Create or import a profile
        ↓
Open a webpage containing a form
        ↓
Analyze the current page
        ↓
Generate suggestions
        ↓
Review, edit, approve, or reject each value
        ↓
Fill approved fields
        ↓
Submit the form manually
```

The extension has three main runtime components:

- **Popup:** starts analysis and displays suggestions for review.
- **Content script:** extracts supported fields and inserts approved values.
- **Background service worker:** loads profile data, applies privacy rules, performs local matching, and optionally calls the selected provider.

## Suggestion modes

### Direct matching only

Matching happens locally using field labels, names, placeholders, aliases, tags, and profile metadata. No LLM provider is contacted.

### Private mapping

The provider receives form descriptions and profile-entry identifiers, but the actual profile values remain local. Returned identifiers are resolved by the extension.

### Full context

Eligible profile values may be sent to the selected provider. This mode can format, combine, or rewrite profile information for more complex fields.

Cloud providers may process information included in requests. Every mode still requires user approval before filling.

## Supported providers

| Provider | Processing | API key |
|---|---|---:|
| Ollama | Local | No |
| OpenAI | Cloud | Yes |
| Anthropic | Cloud | Yes |
| Mistral | Cloud | Yes |

The service worker communicates directly with the selected provider. There is no application proxy.

Ollama endpoints are restricted to loopback addresses such as `localhost` and `127.0.0.1`.

## Profiles and document import

Profiles can contain information such as contact details, addresses, employment, education, skills, certifications, links, availability, and standard application answers.

The extension can import profile candidates from:

- PDF
- DOCX
- TXT

Imported values are reviewed before they are saved. The original document and its full extracted text are not retained after import.

Current import limits:

- Maximum file size: 8 MB
- Maximum PDF pages processed: 12
- Maximum extracted text: 50,000 characters
- No OCR for scanned or image-only PDFs

## Encryption and credentials

Profile data and persistent cloud-provider credentials can be protected with a password-based local vault.

The vault uses AES-256-GCM encryption with a PBKDF2-derived key. When the vault is locked, encrypted profiles and persistent credentials are unavailable.

Provider credentials can be stored:

- For the current browser session only
- Persistently inside the encrypted vault

Browser-side encryption does not protect against every threat. A compromised browser or malicious extension update could access data while the vault is unlocked.

## Installation

### Requirements

- Node.js 24
- npm
- Chrome or another Chromium-based browser

Install dependencies and build the extension:

```bash
npm install
npm run build
```

The production build is created in:

```text
apps/extension/dist
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `apps/extension/dist`.

Reload the extension from `chrome://extensions` after rebuilding.

## Ollama setup

Install Ollama and pull a model, for example:

```bash
ollama pull llama3.2:3b
```

Ensure Ollama is available at `http://localhost:11434`. Then open **Settings → Providers**, select Ollama, choose a model, grant loopback permission, and test the connection.

## Development commands

```bash
npm run dev          # Start the Vite development server
npm run build        # Create a production extension build
npm run typecheck    # Run TypeScript checks
npm run test         # Run unit tests once
npm run test:watch   # Run tests in watch mode
```

## Technology stack

- Chrome Extension Manifest V3
- React 19
- TypeScript 6
- Vite 8
- Tailwind CSS 4
- Zod 4
- Vitest and happy-dom
- Web Crypto API
- PDF.js and Mammoth

## Current limitations

- Forms are never submitted automatically.
- File-upload fields are not filled.
- Scanned PDFs require external OCR first.
- Fully custom controls may not work like native inputs.
- Shadow DOM and cross-origin iframe forms are not fully supported.
- Complex autocomplete widgets may require additional integration.
- Browser-level end-to-end tests are not currently included.

## Documentation

Additional design and implementation notes are available in the [`docs`](docs) directory.

Some planning documents describe earlier development phases and may not reflect the current implementation.

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE).
