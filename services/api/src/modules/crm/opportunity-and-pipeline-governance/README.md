# CRM-CAP-003 — opportunity-and-pipeline-governance

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F009 — Opportunities
- F010 — Opportunity pipeline
- F011 — Probability and expected revenue
- F012 — Sales stages
- F026 — Won / lost reasons

## Status (Prompt 1)

Target location for this capability's domain/application code going forward. No existing
source was bulk-moved here in Prompt 1 — current implementation still lives in the legacy flat
`services/api/src/modules/crm/*.js` files (e.g. `opportunity-operations.js`,
`opportunity-revenue-intelligence.js`, `sales-stage-operations.js`) so public call sites are not
broken mid-migration. See the Architecture Migration Map in `CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
for the file-by-file plan and owning prompt.

New CRM domain implementation for F009/F010/F011/F012/F026 should be added under this directory.
Cross-module imports must still go through `services/api/src/modules/crm/index.js`
(`scripts/validation/verify-architecture.mjs` enforces the public-contract-only import rule).
Do not add ad-hoc top-level directories under `services/api/src/modules/crm/`.
