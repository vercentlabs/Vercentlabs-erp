# Current Mandatory Feature

- Feature ID: F010
- Feature Name: Opportunity Pipeline
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation; F009 Opportunities; existing CRM pipeline/stage and outcome-reason persistence
- Specification path: `02-feature-specs/ERP-010.md`
- Relevant tests:
  - `services/api/tests/crm-opportunity-pipeline-f010.test.mjs`
  - `apps/web/tests/crm-opportunity-pipeline-f010.test.mjs`
  - `scripts/validation/verify-crm-f010-live.mjs`
  - existing F001-F009, CRM scope/security/RBAC, architecture, database, route and build suites
- Current blocker: named-human permission/isolation, concurrency, failure-state, keyboard, responsive and visual UAT remains outstanding. Automated/live technical verification does not replace that acceptance.
