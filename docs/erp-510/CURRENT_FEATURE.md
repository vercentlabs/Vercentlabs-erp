# Current Mandatory Feature

- Feature ID: F009
- Feature Name: Opportunities
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation and F001–F008
- Specification path: `02-feature-specs/ERP-009.md`
- Relevant tests:
  - `services/api/tests/crm-opportunities-f009.test.mjs`
  - `apps/web/tests/crm-opportunities-f009.test.mjs`
  - `scripts/validation/verify-crm-f009-live.mjs`
  - existing F001–F008, CRM scope, security, RBAC, architecture, database, mobile and build suites
- Current blocker: named-human permission/isolation, relationship, failure-state, keyboard, responsive and visual UAT remains outstanding. Automated/live technical verification does not replace that acceptance.
