# F006 UAT — CRM Lead Qualification

## Status

- Automated technical verification: PASSED; see ERP-006 and F006 artifacts
- Human UAT: NOT RUN
- UAT readiness: NOT_READY

Record tester, date, environment, build SHA, organization/company/branch/user IDs, Lead/event/audit/outbox IDs, screenshots, and observed results. Do not mark a scenario passed without a named human result.

## Preconditions

- Apply tenant migration `062_crm_lead_qualification_f006.sql`.
- Prepare Org A Owner, Manager, Rep A, Rep B; Org B Owner and Rep C; two companies/branches; an F004 Website source; and owned/unassigned/archived Leads.

## Manual scenarios

1. Create a valid Lead and confirm Qualification begins Not reviewed.
2. Open Lead Detail and locate the compact Commercial readiness section.
3. Confirm first name and one contact method are shown as required.
4. Confirm company, job title, product interest, estimated value, and source are recommended.
5. Leave recommended fields empty and confirm the Lead remains Ready for a decision.
6. Qualify the Lead, refresh, and confirm persistence.
7. Confirm Qualified text, deciding user, and server time are visible.
8. Inspect DB current fields and the first qualification event.
9. Submit Qualified again and confirm a no-op with no duplicate history/audit/outbox.
10. Mark the Lead Unqualified and select No current requirement.
11. Refresh and confirm state, reason, actor/time, and both history entries.
12. Try Unqualified without a reason and confirm actionable validation.
13. Choose Other without details and confirm it is rejected.
14. Choose Other with meaningful details and confirm persistence.
15. Requalify and confirm all previous decision evidence remains.
16. Change unrelated Lead data and confirm the decision/history is unchanged.
17. Create/prepare a Lead missing first name and confirm qualification is blocked.
18. Create/prepare a Lead missing all contact methods and confirm qualification is blocked.
19. Confirm a low/negative score does not block an otherwise ready Lead.
20. Confirm a high score does not qualify a Lead or override missing required data.
21. As Rep A, qualify Rep A's permitted Lead.
22. As Rep B without global view, directly call Rep A's qualification API and confirm safe denial.
23. As Manager with global view, qualify a permitted scoped Lead.
24. From Org B, call Org A's Lead ID and confirm non-disclosing denial and zero writes.
25. Switch Company/Branch in Org A and confirm direct IDs cannot bypass the selected scope.
26. Qualify an unassigned Lead and confirm owner remains Unassigned.
27. Qualify Rep A's Lead, reassign to Rep B, and confirm Rep B sees state/history.
28. Confirm Rep A loses owner-derived access after reassignment where policy dictates.
29. Confirm source Website remains unchanged through qualify/unqualify/requalify.
30. Deactivate Website and confirm historical inactive source and qualification remain independent.
31. Attempt to qualify an archived Lead and confirm rejection while history remains readable.
32. Confirm public capture begins Not reviewed and preserves F004/F005 behavior.
33. Attempt generic PATCH with canonical and legacy qualification fields; confirm rejection/no mutation.
34. Attempt offline qualification-state forging; confirm rejection/no mutation.
35. Attempt bulk qualification and confirm it is unavailable/rejected.
36. Attempt import with qualification fields and confirm the new Lead remains Not reviewed.
37. Inspect platform audit for old/new state, actor, entity, and event type without contact PII.
38. Inspect outbox for exactly one event per real transition and none for rejected/no-op requests.
39. Confirm qualification never creates Account, Contact, Opportunity, Quotation, or conversion rows.
40. Issue concurrent Qualified and Unqualified requests; confirm serial valid final state and ordered events.
41. Double-click and repeat Enter during submission; confirm one real decision.
42. Simulate timeout, network disconnect, 500, refresh during mutation, and close during request; confirm the UI never reports false success and can recover.
43. Verify a fresh tenant can create and qualify a valid Lead without setup.
44. Verify 1920×1080, 1440×900, 1366×768, 1280×800, and 1024×768 without overflow/alignment defects.
45. Verify 768×1024 tablet layout, modal height, visible actions, and navigation coexistence.
46. Verify 430×932, 390×844, 375×812, 360×800, and 320×568 without body overflow.
47. Complete qualification and unqualification keyboard-only, including reason select and notes.
48. Verify Escape, focus containment/restoration, visible focus, semantic heading/dialog names, announced errors/status, non-color state text, practical touch targets, and reduced motion.
49. Verify loading, empty history, validation, 403, 404, 409, network, and server-error states remain clear.

## Evidence record

- Tester: not assigned; human UAT not run
- Date: automated technical work 2026-08-25
- Automated evidence: `artifacts/f006-uat/live-results.json`, `artifacts/f006-uat/responsive-results.json`, and `artifacts/f006-uat/screenshots/`
- Result: TECHNICAL_VERIFICATION_PASSED; HUMAN_UAT_NOT_RUN; NOT_READY
