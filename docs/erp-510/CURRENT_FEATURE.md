# Current Mandatory Feature

- Feature ID: F011
- Feature Name: Probability and Expected Revenue
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation; F009 Opportunities; F010 Opportunity Pipeline
- Specification path: `02-feature-specs/ERP-011.md`
- Relevant tests:
  - `services/api/tests/crm-probability-expected-revenue-f011.test.mjs`
  - `apps/web/tests/crm-probability-expected-revenue-f011.test.mjs`
  - `scripts/validation/verify-crm-f011-live.mjs`
  - existing F001-F010, CRM scope/security/RBAC, architecture, database, route and build suites
- Current blocker: named-human permission/isolation, concurrency, calculation, keyboard, responsive and visual UAT remains outstanding.
