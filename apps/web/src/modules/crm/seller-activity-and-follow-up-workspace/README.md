# CRM-CAP-004 — seller-activity-and-follow-up-workspace

Canonical CRM capability directory, frozen by `docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md`
(CRM vNext Prompt 1). Owns:

- F013 — Calls
- F014 — Meetings
- F015 — Tasks
- F016 — Follow-ups and reminders
- F017 — Notes and attachments
- F018 — Email history
- F019 — Activity timeline

## Status (Prompt 1)

Target location for this capability's UI/application code going forward. No existing source
was bulk-moved here in Prompt 1 — current implementation still lives under the legacy flat
`apps/web/src/modules/crm/components/`, `server/` and `features/` structure so that public
imports and runtime contracts are not broken mid-migration. See the Architecture Migration Map
in `CRM_VNEXT_IMPLEMENTATION_REGISTER.md` for the file-by-file plan and owning prompt.

New CRM implementation work for F013–F019 should be added under this directory.
Do not add ad-hoc top-level directories under `apps/web/src/modules/crm/` —
`scripts/validation/verify-architecture.mjs` enforces the frozen top-level allowlist.
