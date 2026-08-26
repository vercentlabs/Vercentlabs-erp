# F001 — Leads UAT and Evidence

## Readiness

- Feature status: TESTING
- UAT status: NOT_READY
- Manual tester: pending
- Manual execution date: pending
- Environment/build: pending
- Automated evidence date: 2026-08-24
- Canonical runtime: Node 24.19.0 and pnpm 11.21.0.

No live browser UAT is claimed by this document.

## Automated/source evidence

- Focused F001 domain and record-scope run: 36 passed, 0 failed.
- Focused F001 web/API contract run: 8 passed, 0 failed.
- Full API suite: 113 passed, 0 failed.
- Full web suite: 330 passed, 0 failed.
- Web typecheck: passed.
- Web lint: 0 errors; one unrelated existing warning in `apps/web/src/app/(app)/dashboard/page.tsx` for unused `WorkItemList`.
- Architecture verification: passed.
- Database structure verification: passed for 33 platform and 56 tenant migrations; this was static analysis and did not contact a live database.
- Integration suite: 1 passed, 0 failed.
- Security suite: 4 passed, 0 failed.
- Enterprise RBAC suite: 11 passed, 0 failed.
- Route verification: passed; 116 pages and 261 API routes checked (static analysis).
- Production web build: passed; 145 static pages generated.

## Manual scenario

Record tester, timestamp, build identifier and screenshots/query evidence for every item.

1. Open CRM → Leads.
2. Create a Lead with first name and email only.
3. Confirm the stored email is trimmed and lowercase after refresh.
4. Create a Lead with first name and mobile only.
5. Create a Lead with first name and alternate phone only.
6. Attempt a Lead with no contact method; confirm a stable validation response and inline/form feedback.
7. Attempt an invalid email; confirm it is rejected without a raw database error.
8. Search for each created Lead by code, name, email/phone and company as applicable.
9. Open Lead Detail and verify identity, owner, contact, business, location and system data.
10. Edit basic identity, contact, commercial and location fields.
11. Attempt to remove email, mobile and alternate phone together; confirm rejection.
12. Replace the only email with a mobile in one edit; confirm success.
13. Refresh the list and detail pages; confirm persistence.
14. As a restricted seller, attempt list/search/direct GET/PATCH/archive access to another seller's private Lead; confirm non-disclosing denial.
15. As a manager with `crm.records.view_all`, confirm access within the active company/branch scope.
16. Archive a disposable Lead from Lead Detail after reading the confirmation.
17. Confirm the Lead leaves the default active list, appears with `status=archived`, remains persisted and cannot be archived by an unauthorized actor.
18. Verify create/update/archive audit events and Lead outbox events in the scoped database.
19. Verify the database rejects new/changed rows with blank first name or no contact method while legacy rows remain deployment-safe under the `NOT VALID` constraints.
20. Check the workspace on a large desktop and laptop.
21. Check the workspace on tablet with collapsed platform navigation.
22. Check mobile list cards, Lead Detail and create/edit forms without desktop-table recreation or horizontal overflow.
23. Complete keyboard-only navigation, visible-focus, accessible-name and archive-confirmation checks.
24. Exercise loading, empty, validation-error, transport-error, retry and success-navigation states.

## Sign-off

- Result: pending
- Blocking defects: pending
- Evidence links: pending
- Approved by: pending

F001 must remain TESTING / NOT_READY until this section contains real browser and live-database execution evidence.
