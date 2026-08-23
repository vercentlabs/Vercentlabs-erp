# Current Mandatory Feature

- Feature ID: F001
- Feature Name: Leads
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: Protected core foundation (authentication, tenant/company/branch access, module entitlement, permissions, audit)
- Specification path: `02-feature-specs/ERP-001.md`
- Relevant tests:
  - `services/api/tests/crm-leads-f001.test.mjs`
  - `services/api/tests/crm-core.test.mjs`
  - `services/api/tests/crm-record-scope.test.mjs`
  - `apps/web/tests/crm-leads-f001.test.mjs`
- Current blocker: manual UAT evidence has not yet been executed and recorded; automated verification and live F001 constraint checks pass.
