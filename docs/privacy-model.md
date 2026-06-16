# Privacy Model

Core principles (Phase 1):
- Local-first: local mode is the default — no data leaves the device.
- Encrypted by design: vault storage is planned to be encrypted using Web Crypto + IndexedDB.
- Selected-profile principle: the user must select the active profile before analysis or suggestions.
- Review-before-fill: suggestions are shown and must be explicitly approved before insertion.
- Minimal exposure: only minimal relevant data is retrieved and used for suggestions.

Phase 1 implements UI placeholders and documentation for these principles; enforcement and cryptography are planned for later phases.
