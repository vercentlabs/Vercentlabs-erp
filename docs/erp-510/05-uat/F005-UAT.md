# F005 UAT — CRM Lead Assignment

## Status

- Automated technical verification: implemented; see ERP-005 and `artifacts/f005-uat`
- Human UAT: NOT RUN
- UAT readiness: NOT_READY

Record tester, date, environment, build SHA, both organization IDs, company/branch IDs, users/roles, Lead/source/policy/event/outbox IDs, screenshots, and observed results. Do not mark a scenario passed without a named human result.

## Preconditions

- Apply tenant migration `061_crm_lead_assignment_f005.sql`.
- Prepare two organizations; a manager with `crm.leads.manage` and `crm.records.view_all`; a representative without global view; active, inactive, removed, and cross-organization users; one F004 Website source; and a public capture form.

## Manual scenarios

1. Open an owned Lead and verify the current owner is a human name, not a UUID.
2. Open an unassigned Lead and verify it says Unassigned.
3. As an authorized manager, open Change Owner from Lead Detail.
4. Verify focus enters the dialog, its title is announced, Current owner is visible, and fields have labels/help.
5. Search an eligible user by partial name and email; verify bounded results from the current organization only.
6. Select the user, assign once, refresh, and verify the owner persisted.
7. Verify list/Kanban/detail/edit all show the same canonical owner.
8. Verify the previous representative loses owner-derived access after reassignment.
9. Verify the new representative gains owner-derived access within company/branch scope.
10. Reassign again and verify the second old/new transition.
11. Assign the current owner again; verify success/no-op and no duplicate audit/outbox record.
12. Double-click/submit while pending; verify one transition and disabled pending control.
13. As an unauthorized representative, verify Change Owner is absent and direct assign API returns 403.
14. Try generic PATCH with owner plus another field and bulk owner update; verify bypass rejection.
15. Submit malformed, cross-organization, inactive, suspended, CRM-ineligible, and removed-member IDs; verify safe rejection without tenant/user leakage.
16. Remove/inactivate an existing owner; verify historical Leads keep the name with Inactive text and cannot newly select that person.
17. Inspect assignment history for actor, timestamp, old owner, new owner, and human rule/manual reason.
18. Inspect `crm_lead_assignment_events`; verify one row per real transition and organization/Lead/policy relationships.
19. Inspect `crm.leads.assigned` outbox rows; verify one per transition and no email, phone, or other Lead PII.
20. Create a Lead with an explicit eligible owner; verify explicit owner wins and persists.
21. Create a Lead with an explicitly blank owner; verify Unassigned.
22. Create a Lead with owner omitted and no rules; verify success and understandable Unassigned fallback.
23. Open CRM Setup → Assignment Rules and verify it is not a primary-sidebar item.
24. Create a fixed Website → Priya rule; verify priority, source, strategy, owner, and status persist.
25. Create Lead Rahul with Source Website; verify Source Website and Owner Priya in UI and DB.
26. Create two rules with different priorities; verify first eligible match uses ascending priority then stable ID.
27. Make the first fixed owner unavailable; verify evaluation continues to the next eligible matching rule.
28. Configure round robin with two eligible members; create sequential Leads and verify deterministic rotation.
29. Create Leads concurrently against round robin; verify locked state, no lost advancement, and eligible distribution.
30. Attempt empty member list, unsupported criterion, invalid country/source, territory/workload mode, overlong priority, and duplicate name; verify validation.
31. Deactivate a rule; create a matching Lead and verify the rule is ignored.
32. Change a rule owner; verify existing Leads are unchanged and only new Leads use the new owner.
33. Deactivate Website; verify existing Lead remains Source Website / Inactive and Owner Priya.
34. Reassign that Lead from Priya to Rahul; verify source is unchanged and owner changes.
35. Submit public capture with an eligible configured owner; verify owner/event/outbox persistence.
36. Make configured capture owner ineligible; verify canonical active rule then Unassigned fallback without capture failure.
37. In a fresh organization with zero rules, create a Lead successfully; configure the first rule without missing-assignee deadlock.
38. Switch the runtime tenant context and query the tested Lead/policy/events; verify zero cross-organization rows.
39. Verify safe loading, empty, validation, 403, 404, 409, network-failure, 500, retry, and recovery states.
40. Verify 1920×1080 and 1440×900 desktop alignment and modal geometry.
41. Verify 1366×768, 1280×800, and 1024×768 laptop layouts.
42. Verify 768×1024 tablet portrait, stacked fields, scroll, and visible actions.
43. Verify 430×932, 390×844, 375×812, 360×800, and 320×568 mobile layouts without body overflow.
44. Complete owner search/select/assign/cancel/Escape and rule configuration keyboard-only.
45. Verify visible focus, focus trap/restore, semantic dialog/combobox names, status text, associated errors, live feedback, and practical touch targets.
46. Enable reduced motion and verify all essential state remains understandable.

## Evidence record

- Tester: not assigned; human UAT not run
- Date: automated technical work 2026-08-25
- Automated evidence: `artifacts/f005-uat/run-live-f005.mjs`, `responsive-results.json`, and PNG captures
- Result: HUMAN_UAT_NOT_RUN; NOT_READY
