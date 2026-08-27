# Current Mandatory Feature

- Feature ID: F014
- Feature Name: Meetings
- Module: CRM
- Priority: P0
- Status: TESTING
- UAT: NOT_READY
- Dependencies: protected core foundation; F001 Leads; F002 Accounts / companies; F003 Contacts; F009 Opportunities; F013 Calls; existing CRM Activities and calendar/meeting-booking persistence
- Specification path: `02-feature-specs/ERP-014.md`
- Relevant tests:
  - `services/api/tests/crm-meetings-f014.test.mjs`
  - `apps/web/tests/crm-meetings-f014.test.mjs`
  - `packages/shared-sdk/tests/mobile-client.test.mjs`
  - `scripts/validation/verify-crm-f014-live.mjs`
  - existing F001-F013, CRM scope/security/RBAC, architecture, database, route, mobile and build suites
- Current blocker: named-human permission/isolation, Meeting lifecycle, attendee/public-booking, offline/mobile, keyboard, responsive and visual UAT remains outstanding.
