# Knowledge Base Design

Design (conceptual): three layers:

- Raw source layer: imported files and extracted text with metadata (file name, MIME type, import date, hash, profile assignment).
- Structured knowledge layer: normalized facts and reusable values annotated with sensitivity and provenance.
- Generated wiki/summary layer: human-readable markdown summaries linking back to structured entries and sources.

Phase 1 provides type placeholders and documentation for the knowledge base; actual ingestion, parsing, and storage are future work.
