# F003 UAT — CRM Contacts

## Status

- Automated gate: focused and broad Node 24 gates passed
- Manual browser UAT: not performed
- Automated responsive browser verification: passed at 1440, 768, 390, and 360px
- Live database verification: passed
- UAT readiness: NOT_READY

Record tester, date, environment, build SHA, scope IDs, Contact/Account IDs, audit/outbox IDs, screenshots, and database evidence when executed.

## Preconditions

1. Apply tenant migration `058_f003_crm_contacts.sql` in UAT.
2. Prepare two organizations and two companies in one organization.
3. Prepare one active and one archived F002 Account.
4. Prepare a CRM viewer and a `parties.manage` user.
5. Confirm CRM entitlement is active.

## Functional sequence

1. Open CRM → Relationships → Contacts and verify hierarchy, normal/empty state, and Create action permissions.
2. Create standalone `Priya Shah` with work email only.
3. Create `Rahul Sharma` linked to the active Account with job title and mobile only.
4. Verify inline required/reachability errors, saving state, and double-submit protection.
5. Verify Contact Detail, then click the Account name and return.
6. Refresh and verify persisted normalized values and Account relationship.
7. Search by first name, last name, email, mobile/phone, job title, and Account name.
8. Filter by active Account, active, archived, and all.
9. Edit job title and email while omitting mobile and Account; refresh and prove they remain.
10. Change to another accessible active Account, then unlink the Account.
11. Reject blank/whitespace first name, invalid email, obvious invalid phone, and no reachable channel.
12. Reject assignment to an inaccessible or archived Account.

## Authorization and isolation

13. CRM viewer: list/detail readable; create/edit/archive absent; direct writes return 403.
14. `parties.manage` user: create/edit/link/unlink/archive available.
15. Switch active companies; linked Contacts outside the active company do not appear.
16. Confirm standalone Contacts remain organization-wide by documented design.
17. Organization B cannot list/search/GET/PATCH/archive Organization A Contact or assign its Account.
18. Disabled CRM entitlement denies page/API.
19. Arbitrary companyId, branchId, and ownerUserId are rejected.

## Archive and relationship safety

20. Link a disposable Contact to existing Opportunity/activity data where available.
21. Archive the disposable Contact and verify confirmation preservation copy.
22. Active list hides it; archived filter finds it; direct permitted detail shows Archived.
23. Account remains active and unchanged.
24. Opportunity, activity, communication, Lead conversion, and other historical references retain the same Contact ID.
25. An archived Account remains readable from a historically linked Contact; new archived-Account assignment fails.

## Persistence, audit, and outbox

26. Inspect `tenant.contacts` identity, normalized channels, optional `party_id`, status, and `archived_at`.
27. Verify forced RLS remains enabled.
28. Inspect `crm.contacts.created`, `crm.contacts.updated`, and `crm.contacts.archived` audit rows.
29. Inspect matching `tenant.crm_outbox_events` rows.
30. Verify API errors disclose no SQL, table, constraint, stack, or cross-tenant existence details.

## Responsive and accessibility

31. Test 1920, 1440, 1024, 768, 430, 390, and 360px widths.
32. Verify desktop table and tablet/mobile cards with no horizontal overflow.
33. Verify create/edit drawer, Account lookup, errors, and sticky actions at every width.
34. Keyboard only: search/filter, Account lookup arrows/Enter/Escape, drawer focus trap/restore, edit, and archive confirmation.
35. Verify visible focus, accessible names, required/error announcements, text statuses, mail/tel links, and 44px touch targets.
36. Verify loading, success, fresh-empty, filtered-empty, validation, server-error, retry, and archive-error states.

## Evidence record

- Tester: not assigned; human UAT not run
- Date: automated technical verification 2026-08-25
- Environment/build SHA: local PostgreSQL 16; Node 24.19.0; pnpm 11.21.0; base revision c8ca7f96 plus working-tree F003
- Organization/company IDs: seeded Vercent Demo Manufacturing context; sensitive organization identifiers not copied into this document
- Contact/Account IDs: Contact `2d41b5a4-2d7a-4364-87b1-2e9b6389d76a`; standalone Contact `056d7bef-d970-4ae0-8a93-3bb0735c026a`; Account `82bbb93c-be6c-4d21-a1f8-63efc447a902`
- Audit/outbox: one created, one updated, and one archived event verified in each store for the linked Contact
- Database evidence: linked persistence, `VP Sales` update, normalized email, Account FK preservation, soft archive, standalone null Account, active Account preservation, and forced RLS all returned true
- Desktop/tablet/mobile screenshots: `artifacts/f003-uat/*.png`; metrics and functional checks: `artifacts/f003-uat/live-uat.json`
- Keyboard/accessibility notes:
- Result: AUTOMATED_TECHNICAL_PASS; HUMAN_UAT_NOT_RUN
