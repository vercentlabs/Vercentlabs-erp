# CRM-CAP-007 — crm-conversion-and-sales-handoff

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F022 — Lead-to-opportunity conversion
- F023 — Opportunity-to-quotation conversion

## Status (Prompt 1)

Target location for this capability's domain/application code going forward. No existing
source was bulk-moved here in Prompt 1. See the Architecture Migration Map in
`CRM_VNEXT_IMPLEMENTATION_REGISTER.md` for the file-by-file plan and owning prompt.

New CRM domain implementation for F022/F023 should be added under this directory, including the
eventual explicit CRM permission ∩ Sales permission intersection check for the
Opportunity → Quotation boundary (see issue ledger).
Cross-module imports must still go through `services/api/src/modules/crm/index.js`
(`scripts/validation/verify-architecture.mjs` enforces the public-contract-only import rule).
Do not add ad-hoc top-level directories under `services/api/src/modules/crm/`.
