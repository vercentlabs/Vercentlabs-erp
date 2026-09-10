# CRM-CAP-002 — lead-lifecycle-qualification-and-prioritization

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F005 — Lead assignment
- F006 — Lead qualification
- F007 — Lead stages and statuses
- F027 — Basic lead scoring

## Status (Prompt 1)

Target location for this capability's domain/application code going forward. No existing
source was bulk-moved here in Prompt 1 — current implementation still lives in the legacy flat
`services/api/src/modules/crm/*.js` files (e.g. `lead-lifecycle.js`, `lead-qualification.js`,
`lead-governance.js`) so public call sites are not broken mid-migration. See the Architecture
Migration Map in `CRM_VNEXT_IMPLEMENTATION_REGISTER.md` for the file-by-file plan and owning
prompt.

New CRM domain implementation for F005/F006/F007/F027 should be added under this directory.
Cross-module imports must still go through `services/api/src/modules/crm/index.js`
(`scripts/validation/verify-architecture.mjs` enforces the public-contract-only import rule).
Do not add ad-hoc top-level directories under `services/api/src/modules/crm/`.
