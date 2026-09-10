# CRM-CAP-008 — pipeline-analytics-and-forecasting

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F024 — Pipeline dashboard
- F025 — Sales forecast
- F030 — CRM reports

## Status (Prompt 1)

Target location for this capability's UI/application code going forward. No existing source
was bulk-moved here in Prompt 1 — current implementation still lives under the legacy flat
`apps/web/src/modules/crm/components/`, `server/` and `features/` structure so that public
imports and runtime contracts are not broken mid-migration. See the Architecture Migration Map
in `CRM_VNEXT_IMPLEMENTATION_REGISTER.md` for the file-by-file plan and owning prompt.

New CRM implementation work for F024/F025/F030 should be added under this directory.
Do not add ad-hoc top-level directories under `apps/web/src/modules/crm/` —
`scripts/validation/verify-architecture.mjs` enforces the frozen top-level allowlist.
