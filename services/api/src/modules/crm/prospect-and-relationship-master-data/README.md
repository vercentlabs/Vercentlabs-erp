# CRM-CAP-001 — prospect-and-relationship-master-data

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F001 — Leads
- F002 — Accounts / companies
- F003 — Contacts
- F004 — Lead sources
- F008 — Duplicate detection

## Status (Prompt 1)

Target location for this capability's domain/application code going forward. No existing
source was bulk-moved here in Prompt 1 — current implementation still lives in the legacy flat
`services/api/src/modules/crm/*.js` files (e.g. `lead-operations.js`, `account-operations.js`,
`contact-operations.js`, `lead-source-operations.js`, `lead-duplicates.js`, `lead-security.js`,
`contact-security.js`) and `features/`, so public call sites are not broken mid-migration. See
the Architecture Migration Map in `CRM_VNEXT_IMPLEMENTATION_REGISTER.md` for the file-by-file
plan and owning prompt.

New CRM domain implementation for F001/F002/F003/F004/F008 should be added under this directory.
Cross-module imports must still go through `services/api/src/modules/crm/index.js`
(`scripts/validation/verify-architecture.mjs` enforces the public-contract-only import rule).
Do not add ad-hoc top-level directories under `services/api/src/modules/crm/`.
