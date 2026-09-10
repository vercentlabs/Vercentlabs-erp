# CRM-CAP-005 — sales-organization-and-coverage

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F020 — Territories and sales teams

## Status (Prompt 1)

Target location for this capability's domain/application code going forward. No existing
source was bulk-moved here in Prompt 1. See the Architecture Migration Map in
`CRM_VNEXT_IMPLEMENTATION_REGISTER.md` for the file-by-file plan and owning prompt.

New CRM domain implementation for F020 should be added under this directory.
Cross-module imports must still go through `services/api/src/modules/crm/index.js`
(`scripts/validation/verify-architecture.mjs` enforces the public-contract-only import rule).
Do not add ad-hoc top-level directories under `services/api/src/modules/crm/`.
