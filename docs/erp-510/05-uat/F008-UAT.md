# F008 — Duplicate Detection UAT

## Readiness

- Feature status: TESTING
- UAT status: NOT_READY
- Named tester: pending
- Date: pending
- Environment/build: pending
- Automated evidence: dedicated F008 API/Web suites plus live verifier

## Human scenarios

Record PASS/FAIL and evidence for every applicable item.

1. Create a unique Lead and verify normal save.
2. Create the same email with different case/whitespace; verify exact duplicate.
3. Create the same mobile with different formatting; verify exact duplicate.
4. Use the same business phone + full name + company; verify exact duplicate.
5. Use only the same full name; verify it is not blocked.
6. Use full name + company without strong contact match; verify probable warning only.
7. Verify exact and probable labels are text, not color-only.
8. Verify matched signals are understandable.
9. As a manager/view-all user, open the authorized matching Lead.
10. As a restricted Rep, create data matching another Rep's Lead.
11. Confirm the duplicate is detected.
12. Confirm no ID, name, company, owner, contact PII, lifecycle or qualification leaks for the hidden match.
13. In another organization, create the same email/mobile; confirm Org A does not affect Org B.
14. Verify active-company scope controls disclosure.
15. Verify active-branch scope controls disclosure.
16. Match an archived Lead; verify historical identity is still detected.
17. Match a converted Lead if fixture exists; verify historical identity is still detected.
18. Edit a Lead without changing identity; verify no duplicate interruption.
19. Edit email/mobile into another Lead's exact identity; verify block.
20. Verify the edited Lead never self-matches.
21. As ordinary seller, attempt to send a forged `duplicateOverrideReason`; verify forbidden.
22. As authorized data-quality manager, attempt an override with no reason; verify rejected.
23. Try a reason under 10 characters; verify rejected.
24. Enter a valid reason; verify exact override succeeds.
25. Inspect `crm_lead_duplicate_overrides`; verify one evidence row with actor/operation/matched IDs/reason.
26. Attempt UPDATE/DELETE of that evidence row in a safe rolled-back test; verify immutable trigger blocks it.
27. Confirm ordinary duplicate pre-checks do not create override evidence.
28. Submit the same public capture form twice with an exact identity.
29. Confirm no second Lead is created.
30. Confirm both public responses are generic accepted responses and do not reveal CRM membership.
31. Repeat with the published Lead Acquisition form; verify public response is equally non-disclosing.
32. Import a CSV row that exactly duplicates an existing Lead; verify it is counted as skipped, not created.
33. Verify a unique import row still creates normally.
34. Sync an offline-created exact duplicate; verify server returns conflict rather than silently creating another Lead.
35. Run two concurrent exact-email creates; verify at most one new Lead commits.
36. Run two concurrent exact-mobile creates; verify at most one new Lead commits.
37. Verify a rejected duplicate does not advance F005 round-robin assignment state.
38. Verify duplicate detection does not change F004 Source.
39. Verify duplicate detection does not change F005 Owner on the existing Lead.
40. Verify duplicate detection does not change F006 Qualification.
41. Verify duplicate detection does not change F007 Lifecycle.
42. Desktop 1440×900: create warning/override UI usable.
43. Laptop 1366×768: no clipped action or horizontal body overflow.
44. Tablet 1024×768 and 768×1024: warning/edit surfaces usable.
45. Mobile 430×932, 390×844, 360×800 and 320×568: cards, textarea and actions fit viewport.
46. Keyboard-only: reach matching Lead link and override reason without mouse.
47. Confirm visible focus on override textarea and actionable links/buttons.
48. Simulate duplicate pre-check network failure; final server save must still enforce exact duplicates.
49. Double-submit an exact duplicate; verify no double create.
50. Perform final visual/HCI sign-off and record tester/date/evidence.

## Acceptance

F008 may be marked COMPLETE / READY only when mandatory scenarios pass, there are no open P0/P1 defects, technical gates remain green, and named-human evidence is recorded here or in the UAT register.
