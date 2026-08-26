# F002 UAT — CRM Accounts / Companies

## Status

- Automated gate: passed
- Manual browser UAT: not performed
- Live database verification: passed for the automated lifecycle run
- UAT readiness: NOT_READY

Automated evidence was recorded on 2026-08-25 against the local UAT stack. The migration reached tenant version 057; Account `37ccacab-8dbe-494d-8d12-a352b6477b11` (`PTY-00003`) was created, edited, searched, archived, and inspected. The primary Pune address, normalized lowercase email, preserved omitted email, inactive/archive state, and `created`/`updated`/`archived` audit and outbox rows were confirmed. Screenshots and machine-readable results are under `artifacts/f002-uat/`.

Automated responsive coverage passed at 1440, 768, 390, and 360px with zero horizontal overflow and 44px minimum controls. The remaining sequence below must be completed by a named human tester, particularly keyboard focus, role-specific UI/API behavior, cross-company isolation, cross-organization isolation, and the full requested viewport matrix.

## Preconditions

1. Apply tenant migration `057_f002_crm_accounts.sql` in UAT.
2. Prepare two organizations and two companies in one organization.
3. Prepare a CRM viewer, a `parties.manage` user, and an owner/manager.
4. Confirm CRM entitlement is active.

## Functional sequence

1. Open CRM → Relationships → Accounts; verify empty/normal state and no supplier-only parties.
2. Create `Acme Manufacturing` with Manufacturing, `https://acme.example`, phone, mixed-case email, Pune/Maharashtra/IN address, and INR.
3. Verify required indicators, inline errors, saving state, and double-submit protection.
4. Save; verify Account Detail and generated code. Refresh and verify persistence/lowercase email.
5. Search by Acme, code, website/domain, phone, email, and Pune.
6. Filter by industry, country, active, archived, and all.
7. Edit name/industry/location while omitting phone/email; refresh and prove omitted values remain.
8. Reject whitespace name, invalid email, `javascript:` website, and incomplete address with actionable codes/copy.
9. Create a second disposable Account.

## Authorization and isolation

10. CRM viewer: list/detail readable; create/edit/archive absent; direct writes return 403.
11. Manager/owner with `parties.manage`: lifecycle available.
12. Switch active companies; verify scoped Accounts do not leak.
13. Organization B cannot search or GET/PATCH/archive Organization A Account.
14. Disabled CRM entitlement denies page/API.
15. Arbitrary `companyId` cannot bypass session scope.

## Archive and relationship safety

16. Link disposable Contacts and Opportunities using their existing features.
17. Archive the disposable Account; verify preservation copy.
18. Active list hides it; archived filter finds it; direct permitted detail shows Archived.
19. Contacts/Opportunities remain with unchanged `party_id`; no party/relationship hard delete occurred.

## Persistence, audit, and events

20. Inspect `tenant.business_parties` normalization, organization/company, status, and `archived_at`.
21. Inspect the primary `tenant.addresses` row.
22. Inspect audit rows for `crm.accounts.created/updated/archived`.
23. Inspect matching `tenant.crm_outbox_events` rows.
24. Verify API errors disclose no SQL/table/constraint details.

## Responsive and accessibility

25. Test 1920, 1440, 1024, 768, 430, 390, and 360px widths.
26. Verify desktop table and mobile cards, with no horizontal overflow.
27. Verify create/edit drawer, fields, errors, and sticky actions at every width.
28. Keyboard only: open/close drawer, tab/focus trap/restore, edit, and archive confirmation.
29. Verify visible focus, accessible names, required/error announcements, text statuses, and 44px targets.
30. Verify loading, success, empty, filtered-empty, validation, server-error, and archive-error states.

## Evidence record

- Tester:
- Date:
- Environment/build SHA:
- Organization/company IDs:
- Account/audit/outbox IDs:
- Database evidence:
- Desktop/tablet/mobile screenshots:
- Keyboard/accessibility notes:
- Result: NOT_RUN
