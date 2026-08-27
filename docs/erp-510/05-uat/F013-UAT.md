# F013 Calls — Named-human UAT

F013 may move from `TESTING / NOT_READY` to `COMPLETE / READY` only after a named human records tester, date, environment and evidence for the scenarios below.

## Preconditions

Use at least two companies/branches where available, one restricted salesperson, one manager/owner, an active Lead with phone, a do-not-contact Lead, an Account with primary Contact phone, a Contact and an Opportunity linked to a Contact/Account.

## Scenarios

1. Open CRM → Activities → Calls and confirm Calls remain inside the Activities workspace.
2. Restricted user sees only Calls allowed by company/branch/assignee scope.
3. Manager/owner behavior follows active company/branch selector and `crm.records.view_all` rules.
4. User without `crm.activities.manage` can read permitted Calls but cannot see/execute mutation controls.
5. Schedule outbound Lead Call with blank phone; Lead phone auto-resolves and is shown on the saved Call.
6. Schedule outbound Contact Call and verify Contact phone resolution.
7. Schedule outbound Account Call and verify its active primary Contact phone resolves.
8. Schedule outbound Opportunity Call and verify direct Contact then Account Contact fallback.
9. General/Campaign Call without explicit phone is rejected with actionable error.
10. Invalid phone characters/too few/too many digits are rejected.
11. Outbound Call to Lead marked do-not-contact is blocked before any Call/history/outbox row is created.
12. Inbound Call to the same Lead can be logged when otherwise valid.
13. Scheduled Call requires due date/time.
14. Start later than due is rejected.
15. Reminder later than due is rejected.
16. Edit a planned Call and verify assignee/subject/schedule/direction changes persist.
17. A stale edit is rejected and does not mutate Call/history/outbox.
18. Start a planned Call; exact retry is mutation-free.
19. Complete a started Call with each standardized outcome at least once across test records.
20. Completion stores actual end and bounded duration.
21. Exact completed-state retry returns success without second history/outbox event.
22. Completing with different outcome after completion is rejected.
23. Cancel planned/overdue/in-progress Call; exact retry is mutation-free.
24. Completed Call cannot be cancelled; cancelled Call cannot be completed.
25. Lead completion/logging updates Lead contact timestamps only on real completion.
26. Opportunity completion/logging updates Opportunity last-activity timestamp only on real completion.
27. Call History shows scheduled/logged/updated/started/completed/cancelled evidence and actor/time.
28. Attempt to UPDATE/DELETE `crm_call_events` directly in test DB is rejected by immutable trigger.
29. Confirm Call event/audit/outbox payloads do not contain phone number, description or outcome free text.
30. Generic Activity POST/PATCH/archive/complete cannot bypass F013 Call operations.
31. Existing Lead Follow-up with type Call succeeds through F013 and respects do-not-contact.
32. Mobile schedules a Call through the dedicated Call endpoint.
33. Mobile start/complete/cancel works and duplicate network replay remains idempotent.
34. Simulate offline mobile Call create/start/complete/cancel and verify queued replay succeeds once connectivity returns.
35. Search by Call subject and phone works only within authorized scope.
36. Status, direction, today/overdue/upcoming filters return correct Calls.
37. Pagination preserves the current Calls/due/search/status/direction context.
38. Dial button opens the device/browser `tel:` handler and does not claim an embedded telephony provider.
39. Verify desktop, tablet and narrow-mobile layout without horizontal action loss.
40. Keyboard-only operation reaches filters, create/log, relation selectors, row actions and dialogs; visible focus remains clear.
41. Reduced-motion OS setting does not block any workflow.
42. Regression: Meetings/Tasks still use their existing generic Activity workflow and F014/F015 are not marked complete.
43. Regression: F016 Follow-up creation of non-Call activity types still works unchanged.
44. Regression: CRM dashboard/search/timeline/report Activity reads still include Calls.

## Sign-off

- Tester:
- Date:
- Environment / commit:
- Evidence links:
- Result: PASS / FAIL
- Notes:
