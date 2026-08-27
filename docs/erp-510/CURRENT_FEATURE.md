# Current Mandatory Feature

- Feature ID: F013
- Feature Name: Calls
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation; F001 Leads; F002 Accounts; F003 Contacts; F009 Opportunities; existing CRM Activities persistence
- Specification path: `02-feature-specs/ERP-013.md`
- Relevant tests:
  - `services/api/tests/crm-calls-f013.test.mjs`
  - `apps/web/tests/crm-calls-f013.test.mjs`
  - `scripts/validation/verify-crm-f013-live.mjs`
  - existing F001-F012, CRM scope/security/RBAC, architecture, database, route, mobile and build suites
- Current blocker: named-human permission/isolation, call lifecycle, contact-restriction, offline/mobile, keyboard, responsive and visual UAT remains outstanding.
