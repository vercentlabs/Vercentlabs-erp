# Current Mandatory Feature

- Feature ID: F007
- Feature Name: Lead Stages and Statuses
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation and F001–F006
- Specification path: `02-feature-specs/ERP-007.md`
- Relevant tests:
  - `services/api/tests/crm-lead-lifecycle-f007.test.mjs`
  - `apps/web/tests/crm-lead-lifecycle-f007.test.mjs`
  - existing F001–F006, CRM scope, security, RBAC, architecture, and database suites
- Current blocker: named human responsive, keyboard, permission-role, organization-isolation, concurrency, failure-state, and visual UAT sign-off remains outstanding. Automated and live technical verification does not replace that acceptance.
