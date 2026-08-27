# F014 — Meetings — Named-Human UAT

F014 remains TESTING / NOT_READY until every applicable scenario below is executed by a named human in the intended test environment with evidence.

## Scenarios

1. Open CRM → Activities → Meetings and verify only authorized Meetings are visible.
2. Verify a user without CRM Activities manage permission cannot create/update/start/complete/cancel Meetings by direct API call.
3. Create a scheduled Lead Meeting and verify Lead/company/branch/assignee relationship persistence.
4. Create Meetings related to Opportunity, Account and Contact records.
5. Create a general Meeting without a related record.
6. As an all-company administrator, create against a company-scoped related record and verify the Meeting inherits that company/branch rather than becoming organization-wide.
7. Attempt a Contact attendee from another company and verify server rejection.
8. Add active CRM Contact attendees and verify displayed names come from first/last name and email.
9. Add additional guest-email attendees and verify duplicate email entries are de-duplicated.
10. Attempt more than 100 attendees and verify actionable validation.
11. Schedule without start/end and verify rejection.
12. Set end before/equal start and verify rejection.
13. Attempt a Meeting longer than 24 hours and verify rejection.
14. Create an in-person Meeting without location and verify rejection.
15. Create an online Meeting without a valid HTTP(S) URL and verify rejection.
16. Schedule a valid online Meeting and verify the Join action opens the intended URL.
17. Edit a planned Meeting and verify subject/assignee/priority/times/location/attendees persist.
18. Retry the exact edit with a stale token and verify it is mutation-free success.
19. Submit a genuinely stale conflicting edit and verify no Meeting/event/outbox mutation.
20. Start a planned Meeting and verify actual start is recorded.
21. Retry Start after a lost response and verify no duplicate event/outbox evidence.
22. Complete a Meeting as Held and verify actual end/duration/outcome.
23. Complete another Meeting as No show and verify standardized outcome.
24. Retry exact completion and verify no duplicate completion evidence.
25. Attempt a different completion outcome after completion and verify rejection.
26. Verify Held completion updates the related Lead contact timestamps only once.
27. Verify Held completion updates Opportunity last-activity timestamp only once.
28. Verify No-show completion does not falsely touch Lead/Opportunity completion effects.
29. Cancel a planned Meeting and retry the exact cancellation; verify idempotency.
30. Verify completed Meeting cannot be cancelled and cancelled Meeting cannot be completed.
31. Open Meeting history and verify scheduled/logged/updated/rescheduled/started/completed/cancelled evidence as applicable.
32. Attempt UPDATE/DELETE on `tenant.crm_meeting_events` in a test DB and verify the immutable trigger rejects it.
33. Verify Meeting history/outbox/audit evidence does not contain attendee email, meeting URL, description or outcome free-text.
34. Verify generic Activity create/update/archive/complete cannot bypass F014 Meeting governance.
35. Verify legacy generic offline Activity mutation cannot create/complete Meeting records.
36. Use Lead Follow-up with type Meeting and verify it routes through F014 without breaking non-Meeting follow-up types.
37. Create a public Meeting Link booking and verify the host receives a Meeting in CRM Activities.
38. Retry the exact public booking after simulating a lost HTTP response and verify the same booking/activity is returned without duplication.
39. Attempt concurrent booking of the same slot and verify only a valid serialized result is committed.
40. Reschedule a public booking and verify booking/calendar/Meeting activity time stays synchronized with rescheduled Meeting history.
41. Cancel a public booking and verify booking/calendar/Meeting activity status stays synchronized with cancellation history.
42. Verify a booking-managed Meeting cannot be independently edited/cancelled through the manual Meeting API.
43. Mobile schedules a Meeting through the dedicated Meeting endpoint.
44. Mobile start/complete/cancel works and duplicate network replay stays idempotent.
45. Simulate offline mobile Meeting create/start/complete/cancel and verify queued replay succeeds once connectivity returns.
46. Search by Meeting subject/location and verify scope is preserved.
47. Verify status and today/overdue/upcoming filters.
48. Verify pagination preserves Meetings/due/search/status context.
49. Verify desktop, tablet and narrow-mobile layouts without horizontal action loss.
50. Verify keyboard-only operation reaches filters, schedule/log, relation/attendee selectors, row actions and dialogs with visible focus.
51. Verify reduced-motion preference does not block workflows.
52. Regression: F013 Calls still use their governed Call workflow.
53. Regression: F015 Tasks remain unclaimed/not COMPLETE.
54. Regression: F016 Follow-ups/reminders remain unclaimed/not COMPLETE.
55. Regression: dashboards/search/timeline/report Activity reads still include Meetings where applicable.

## Sign-off

- Tester:
- Date:
- Environment / commit:
- Evidence links:
- Result: PASS / FAIL
- Notes:
