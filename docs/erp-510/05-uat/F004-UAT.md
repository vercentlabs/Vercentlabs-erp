# F004 UAT — CRM Lead Sources

## Status

- Automated technical verification: passed; evidence recorded in ERP-004 and `artifacts/f004-uat`
- Human UAT: NOT RUN
- UAT readiness: NOT_READY

Record tester, date, environment, build SHA, organization/company IDs, source/Lead IDs, audit/outbox IDs, screenshots, and observed results.

## Preconditions

- Apply tenant migration `059_f004_crm_lead_sources.sql`.
- Prepare two organizations, an admin with `crm.settings.manage`, a salesperson with `crm.view`/Lead permission but no setup permission, and a working public capture form.

## Manual sequence

1. Open CRM Setup.
2. Open Lead Sources under Lead management and verify no primary-sidebar Lead Sources destination exists.
3. Verify the hierarchy, heading, explanatory copy, active filter, and default seeded catalogue.
4. Create `Website` if it does not already exist; otherwise create a disposable equivalent and record why.
5. Create `Referral` if it does not already exist; otherwise use the seeded record.
6. Create `Cold Call` as a user-defined source and verify its generated code is not requested from the user.
7. Submit a blank source name and verify field-level rejection.
8. Submit a whitespace-only name and verify field-level rejection.
9. Try duplicate `website` with case/space variation and verify safe duplicate rejection.
10. Edit Website description and display order; refresh and verify persistence and stable code.
11. Open CRM → Leads.
12. Create a Lead with Website and verify only active source choices are offered.
13. Open Lead Detail and verify Source displays Website, never a UUID.
14. Edit the Lead and change source to Referral.
15. Refresh list/detail/edit and verify Referral persists.
16. Deactivate Referral and verify confirmation states usage/history preservation.
17. Verify the existing Lead still displays Referral with Inactive text.
18. Open Lead edit and verify its inactive current value remains visible.
19. Edit an unrelated Lead field without changing source and verify Referral remains.
20. Try assigning inactive Referral to a new Lead; verify it is absent and direct submission is rejected.
21. Reactivate Referral.
22. Create a new Lead with Referral and verify success.
23. Submit Organization A source ID to Organization B Lead create/update and verify safe rejection without existence leakage.
24. As restricted salesperson, verify active sources load and can be used on permitted Leads.
25. As restricted salesperson, verify Lead Source configuration page/actions and direct writes are denied.
26. As admin, verify create/edit/deactivate/reactivate are available.
27. Verify created, updated, deactivated, and reactivated audit events and safe metadata.
28. Verify matching transactional outbox events.
29. Inspect source rows, normalized-name uniqueness, status, archived timestamp, ordering, system flags, FKs, indexes, and forced RLS.
30. Submit the public capture form and landing/book-demo path; verify Lead persistence and active/default source fallback if the configured source is inactive.
31. Create/simulate a fresh organization; verify eight seeded sources, one Website default, Create Lead usability, and public-capture usability without manual SQL.
32. Verify large desktop layout at 1920 and 1440px.
33. Verify laptop layout at 1280 and 1024px.
34. Verify tablet cards/drawer at 768px with no horizontal document overflow.
35. Verify mobile cards, stacked filters, drawer, and sticky actions at 430, 390, and 360px.
36. Complete search, filter, create, edit, deactivate, reactivate, close, and confirmation flows keyboard-only.
37. Verify visible focus, focus trap/restore, semantic labels, associated errors, live feedback, status text, and practical touch targets.
38. Verify fresh-empty and filtered-empty states and permission-aware Create action.
39. Verify loading, validation, server failure, retry, pending/double-submit, and lifecycle failure states.
40. Enable reduced motion and verify no essential feedback depends on animation.

## Evidence record

- Tester: not assigned; human UAT not run
- Date: automated technical work 2026-08-25
- Result: HUMAN_UAT_NOT_RUN; NOT_READY
