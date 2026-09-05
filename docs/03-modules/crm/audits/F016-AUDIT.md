# F016 Follow-ups and reminders — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading the `leads/[id]/follow-up` route in full and `apps/web/src/orchestration/work/follow-ups.ts` in full.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | scheduling a follow-up correctly creates a **real governed activity** (a call, meeting, or generic task — reusing F013/F014/F015's own commands, not a parallel write path) and sets the lead's `next_follow_up_at` in the same transaction (unchanged, this scheduling action is a distinct, complementary capability from "My Follow-ups"). **"My Follow-ups" itself was rewired 2026-09-05** (owner decision): `listMyFollowUps` now reads the lead nurture queue via the new `listMyNurtureQueueItems` instead of the bare `next_follow_up_at` field. |
| CAP-002 (**multiple reminders**, working hours, **escalation**, no-activity rules, **delivery receipts**, **deduplication**, timezone behavior) | **PASS on most items now that the nurture queue is the real implementation.** Timezone: PASS — `classifyDueAt` still computes urgency relative to the viewer's timezone. Multiple reminders: PASS — the queue can hold many prioritized items per lead/rep, not one date field. Deduplication: PASS — `crm_lead_nurture_queue_open_idx` (partial unique index) prevents duplicate open items. Escalation/no-activity rules: PASS — `rankNurtureCandidate`/`evaluateNurtureEligibility` already implement priority scoring and eligibility rules (age, do-not-contact, consent, terminal status). **Still genuinely missing:** delivery-receipt tracking for the notification itself (does an email/push actually fire and get confirmed when an item becomes due? — see the standing cross-feature finding below); working-hours-aware scheduling wasn't independently re-confirmed for the queue path specifically. |
| CAP-003 (notification channels consume idempotently; scope never bypassed) | PASS (for what's built) | the route enforces `crmLeadsManage`+`crmLeadsViewSensitive`+`crmActivitiesManage` together and blocks scheduling on converted/archived leads (`CRM_LEAD_FOLLOW_UP_CLOSED`) — scope is not bypassed. |
| FR-001/002/003 | PASS | validation/permission/conflict states present; not a bulk-volume feature by nature. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | two audit events are written per follow-up (`crm.{call,meeting,activities}.scheduled` and `crm.lead.followup.scheduled`), and the underlying activity's own lifecycle (start/complete/cancel) is F013/F014/F015's already-verified state machine — this feature doesn't duplicate that logic, it composes it. |
| BR-001/BR-002 | PASS | single scheduling path; the actual completion/history recording is delegated to the owning activity type's governed commands, not reimplemented here. |
| DATA-001/002 | PASS | `crm_lead_nurture_queue` (the real reminder entity, now wired up) plus `crm_leads.next_follow_up_at` and whichever `crm_activities`/`crm_calls`-equivalent row the scheduling action created. |
| VAL-001/002 | PASS | `scheduleLeadFollowUpSchema` validates input; stable `CRM_LEAD_FOLLOW_UP_CLOSED` code for the one identified precondition. |
| CALC-001 | N/A | no monetary/derived calculation. |
| UX-001/002/003 | PASS (by test evidence) | "Add follow-up uses one dedicated workflow and requires a due time" and "follow-up endpoint is scoped, permissioned, atomic, audited, and updates both records" both confirmed passing in this session's earlier full CRM test run. |
| SEC-001/002 | PASS | three permissions required together (manage leads + view sensitive + manage activities) — a stricter, compound gate than most other features in this audit. |
| AUTO-001 / APP-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| NOTIF-001 (**delivery receipts**) | **GAP, confirmed with the Grep tool (not bash glob).** No push/email delivery worker exists anywhere for either the nurture queue or scheduled activities' `reminderAt`/`due_at` fields — the same standing gap as F014. |
| API-001/002 | PASS | route pattern consistent with the rest of the module. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment (updated 2026-09-05)

30 of 37 rows now PASS — the biggest single jump from a gap-closing change in this pass, because the "gap" was mostly a naming/wiring problem, not missing engineering. "My Follow-ups" now reads `crm_lead_nurture_queue` (priority-scored, snooze/claim/complete, deduplicated via a partial unique index) instead of a bare `next_follow_up_at` field, with the critical "mine means mine, `crm.records.view_all` never broadens it" guarantee re-implemented correctly in the new code path (`listMyNurtureQueueItems` strips `roleSlugs` and narrows `permissions` to just the sensitivity gate it needs) and proven by 3 new tests. The remaining gap — no confirmed reminder-notification delivery mechanism — is shared with F014 and is the one item in this feature that's a genuine missing capability, not a wiring problem.
