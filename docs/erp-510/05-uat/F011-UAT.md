# F011 — Probability and Expected Revenue UAT

## Readiness

- Feature status: TESTING
- UAT status: NOT_READY
- Named tester: pending
- Date: pending
- Environment/build: pending

## Human scenarios

1. Open an authorized open Opportunity and confirm Amount, Probability and Expected revenue are visible.
2. Verify expected revenue equals amount × probability / 100, rounded to two decimals.
3. Change probability to 0, 50, 72.5 and 100 and verify expected revenue each time.
4. Try -1, 100.01 and more than two decimals; verify actionable validation and no mutation.
5. Edit Opportunity amount through the normal editor; verify expected revenue changes automatically without a probability rewrite.
6. Simulate a lost response by retrying the exact successful probability change with the original now-stale tokens; verify success as a no-op and no duplicate history/audit/outbox mutation.
7. In two sessions, change probability from one session then submit the stale second session; verify conflict and preserved newer value.
8. Forge a stale expectedProbability token; verify conflict and no mutation.
9. As a restricted seller, verify another seller's Opportunity cannot be read or changed by direct probability API call.
10. As a read-only CRM user, verify UI mutation is absent and forged API mutation is rejected.
11. Change probability, then move to another open stage; verify destination stage probability becomes current and expected revenue recomputes.
12. Close Won/Lost, then forge a probability update; verify closed-record rejection.
13. Inspect Probability history for from/to values, expected revenue, actor, date and optional note.
14. Inspect audit/outbox evidence and verify no free-text note is leaked into outbox payload.
15. Verify `/crm/forecast` open pipeline and weighted values exclude Won/Lost records and Won revenue is separate.
16. Verify owner-scoped forecast does not reveal another restricted seller's values.
17. Verify Opportunity list expected revenue matches detail.
18. Verify currency formatting remains correct for configured Opportunity currencies.
19. Verify F010 drag/select stage movement continues to work and recalculates generated expected revenue.
20. Verify generic Opportunity PATCH still cannot forge probability.
21. Desktop 1440×900: probability control/history/metrics have no clipping.
22. Laptop 1366×768: controls remain usable.
23. Tablet 768px and mobile 390/360px: fields, buttons, history and messages remain usable without horizontal page overflow.
24. Keyboard-only: reach probability field, note and submit; visible focus and status/error feedback are understandable.
25. Record named tester/date/environment/evidence and confirm no open P0/P1 defect.

## Acceptance

F011 may be marked COMPLETE / READY only after mandatory scenarios pass, technical gates remain green, and named-human evidence is recorded.
