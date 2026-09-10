# CRM-CAP-001 — prospect-and-relationship-master-data

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F001 — Leads
- F002 — Accounts / companies
- F003 — Contacts
- F004 — Lead sources
- F008 — Duplicate detection

## Status (Prompt 1)

Target location for this capability's UI/application code going forward. No existing source
was bulk-moved here in Prompt 1 — current implementation still lives under the legacy flat
`apps/web/src/modules/crm/components/`, `server/` and `features/` structure so that public
imports and runtime contracts are not broken mid-migration. See the Architecture Migration Map
in `CRM_VNEXT_IMPLEMENTATION_REGISTER.md` for the file-by-file plan and owning prompt.

New CRM implementation work for F001/F002/F003/F004/F008 should be added under this directory.
Do not add ad-hoc top-level directories under `apps/web/src/modules/crm/` —
`scripts/validation/verify-architecture.mjs` enforces the frozen top-level allowlist.
