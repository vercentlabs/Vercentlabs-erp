# F009 — Opportunities UAT

## Readiness

- Feature status: TESTING
- UAT status: NOT_READY
- Named tester: pending
- Date: pending
- Environment/build: pending
- Automated evidence: F009 API/Web suites plus rolled-back PostgreSQL verifier

## Human scenarios

1. Create an Opportunity with only a valid name; verify active company/branch defaults and current-user ownership.
2. Verify the generated Opportunity code is unique and visible.
3. Create with a selected eligible owner; verify owner persists.
4. As restricted seller, try assigning another user; verify server rejection.
5. As manager, select an inactive/non-CRM/out-of-company user using a forged request; verify rejection.
6. Create without selecting Pipeline/Stage; verify an active initial combination is chosen.
7. Select Pipeline only; verify its first active Stage is used.
8. Select Stage only; verify its owning Pipeline is used.
9. Forge Pipeline A + Stage from Pipeline B; verify actionable rejection.
10. Verify persisted Pipeline/Stage composite DB constraint rejects mismatch in a rolled-back DB test.
11. Verify probability/forecast category are derived from Stage and not ordinary editable generic fields.
12. Create with active Account only; verify relationship persists.
13. Create with active Contact only; verify its Account is derived.
14. Select Contact from Account A plus Account B; verify rejection.
15. Link a visible active Lead; verify relationship persists.
16. Forge an archived/inaccessible/cross-company Lead ID; verify scoped rejection without disclosure.
17. Enter amount/currency/expected close; verify valid persistence.
18. Submit negative amount, invalid currency and invalid calendar date; verify field-level actionable errors.
19. Search Opportunity by code/name and open detail.
20. As another restricted seller, verify owner-scoped Opportunity is absent from list and direct detail.
21. As manager/view-all, verify authorized cross-owner visibility.
22. Edit name, Account/Contact, owner, amount, close date, next step and description as applicable; verify persistence.
23. Change Account while retaining a Contact from the old Account; verify rejection until Contact is changed/cleared.
24. Forge generic PATCH for stage/status/probability/forecast/actual-close/outcome fields; verify rejected.
25. Archive an open Opportunity; verify soft `archived` state and relationships/history remain.
26. Repeat archive; verify no duplicate mutation/outbox event.
27. Attempt edit of archived Opportunity; verify read-only rejection.
28. Inspect create/update/archive audit events; verify stable scope/relation metadata and no unnecessary free-text payload.
29. Inspect CRM outbox events; verify minimal Opportunity snapshot and no description/next-step/custom data.
30. Convert a Lead through the existing conversion flow; verify resulting Opportunity still satisfies F009 owner/pipeline/customer invariants.
31. Verify F004 Source, F005 assignment, F006 qualification, F007 lifecycle and F008 duplicate behavior remain unchanged.
32. Verify F010/F011/F012 richer pipeline/forecast/stage behavior is not marked COMPLETE by F009.
33. Desktop 1440×900: list/create/edit/detail usable with no clipped controls.
34. Laptop 1366×768: editor and actions remain usable.
35. Tablet 1024×768 and 768×1024: table/editor/detail usable.
36. Mobile 430×932, 390×844, 360×800 and 320×568: Opportunity workflow fits without body overflow.
37. Keyboard-only: create, select relationships, save, open, edit and archive.
38. Verify visible focus and text-based status/error communication.
39. Simulate save network/server error; verify entered form remains understandable/actionable.
40. Perform final visual/HCI sign-off and record tester/date/evidence.

## Acceptance

F009 may be marked COMPLETE / READY only when mandatory scenarios pass, no P0/P1 defects remain, automated gates stay green, and a named tester/date/evidence are recorded.
