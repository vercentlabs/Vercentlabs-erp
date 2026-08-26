# Current Mandatory Feature

- Feature ID: F008
- Feature Name: Duplicate Detection
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation and F001–F007
- Specification path: `02-feature-specs/ERP-008.md`
- Relevant tests:
  - `services/api/tests/crm-lead-duplicates-f008.test.mjs`
  - `apps/web/tests/crm-lead-duplicates-f008.test.mjs`
  - `scripts/validation/verify-crm-f008-live.mjs`
  - existing F001–F007, CRM scope, public capture, security, RBAC, architecture, database and build suites
- Current blocker: named-human role/isolation, concurrency, failure-state, keyboard, responsive and visual UAT remains outstanding. Automated/live technical verification does not replace that acceptance.
