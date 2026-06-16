# Threat Model (Phase 1)

Assets to protect:
- User knowledge vault (personal data, secrets)
- Active profile contents
- Provenance and audit logs

 - Malicious web page attempting prompt-injection — treat web page data as untrusted and label it accordingly.
 - Hidden fields or deceptive forms requesting secrets — flag hidden inputs and require explicit confirmations.
- Accidental use of wrong profile — require explicit profile selection and surface active profile in the UI.
- Cloud leakage — cloud mode must be disabled by default and require explicit opt-in.

Phase 1 documents these threats and provides placeholders; technical mitigations will be implemented in later phases.
