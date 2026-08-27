# Current Mandatory Feature

- Feature ID: F012
- Feature Name: Sales stages
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation; F009 Opportunities; F010 Opportunity Pipeline; F011 Probability and Expected Revenue
- Specification path: `02-feature-specs/ERP-012.md`
- Relevant tests:
  - `services/api/tests/crm-sales-stages-f012.test.mjs`
  - `apps/web/tests/crm-sales-stages-f012.test.mjs`
  - `scripts/validation/verify-crm-f012-live.mjs`
  - existing F001-F011, CRM scope/security/RBAC, architecture, database, route and build suites
- Current blocker: named-human permission/isolation, configuration, concurrency, integration, keyboard, responsive and visual UAT remains outstanding.
