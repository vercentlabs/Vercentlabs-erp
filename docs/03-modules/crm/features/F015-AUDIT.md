# F015 Tasks — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `task-operations.js` in full (269 lines) and `services/worker/src/handlers/crm-automation-overdue.js` in full.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | prioritized queue via `listCrmTasks` (status/due filters, search), full lifecycle (start/complete/cancel), related-record context preserved via `entityType`/`entityId` with cross-type FK-style validation (`relationRecord`, `:98-133`). |
| CAP-002 (**recurrence**, team/queue tasks, **dependencies**, generated tasks, overdue derivation, linked-record privacy, **idempotent recurrence**) | **PARTIAL — real gaps, but the hardest sub-item (overdue) is excellent.** Overdue derivation: **PASS, and worth calling out as exemplary** — `detectOverdueActivitiesHandler` (`crm-automation-overdue.js`) is a scheduled worker that transitions `planned`/`in_progress` tasks past `due_at` to `overdue` and fires the automation event, with idempotency built entirely into the transition's `WHERE status IN (...)` clause rather than a separate dedup table — a genuinely elegant, correct solution, and the code comments explain the reasoning explicitly. Linked-record privacy: PASS — a task whose `entityType='lead'` requires `crmLeadsViewSensitive` to even view or create (`:84-85`, `:110-111`), correctly extending Leads' sensitivity model to related Tasks. **Gaps:** `recurringRule` is a stored, validated text field (up to 1,000 chars) but **no recurrence engine exists anywhere** — nothing reads a completed recurring task's rule and generates the next occurrence (confirmed by grep: the only other references to `recurringRule` in the codebase are pure field-mapping passthroughs in `index.js`/`offline-sync.js`, not processing logic). No task-dependency field/table found (a task can't declare "blocked by task X"). No team/queue assignment — `assignedTo` is a single user only, no queue concept. |
| CAP-003 (workflows create tasks only through CRM commands) | PASS | `createCrmTask` is the only insertion path (enforced by the generic-resource route delegating to it for `activityType==='task'`, confirmed in F001's audit of `apps/web/src/app/api/crm/[resource]/route.ts`). |
| FR-001/002/003 | PASS | full state workflow with validation/permission/conflict states; `listCrmTasks` paginates correctly (limit capped at 100). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | `EDITABLE`/`TERMINAL` sets correctly gate transitions (`planned`/`in_progress`/`overdue` → `completed`/`cancelled`, terminal states are read-only); `stale()` gives consistent conflict codes; idempotent no-op transitions return the existing task rather than erroring (`transition`, `:247`) — a **fifth confirmed instance** of the correct idempotent-replay pattern seen throughout this audit. |
| BR-001/BR-002 | PASS | single mutation path; `crm_task_events` is insert-only. |
| DATA-001/002 | PASS for what exists | `crm_activities` (activity_type='task') and `crm_task_events` used correctly; no dependency/queue tables exist, per CAP-002. |
| VAL-001/002 | PASS | subject/description length limits, schedule ordering (start ≤ due, reminder ≤ due) validated server-side, stable `CRM_TASK_*` codes. |
| CALC-001 | N/A | no monetary/derived calculation. |
| UX-001/002/003 | PASS (by test evidence) | covered by the shared CRM Activities workspace tests already confirmed passing this session (F013/F014's dedicated-workspace tests share this surface). |
| SEC-001/002 | PASS | scope enforcement (`scopeSql`) plus the lead-sensitivity extension noted above — actually stricter than a baseline task feature needs to be. |
| AUTO-001 | PARTIAL, with a directly relevant finding | The overdue-automation trigger works correctly (see above), but a code comment in `crm-automation-overdue.js:9-15` explicitly documents that **three other CRM automation triggers** (`lead.updated`, `lead.qualified`, `campaign.member_responded`) are "missing synchronous call sites in mutation code paths" — a known, previously-identified gap in the broader CRM automation engine, not specific to Tasks but discovered while auditing this feature. Worth carrying into the cross-feature gap list. |
| APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | route pattern consistent with the rest of the module. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

24 of 37 rows PASS, including an exemplary piece of engineering (the overdue-detection worker's WHERE-clause-as-idempotency design). Two real, scoped gaps: no recurrence-processing engine behind the stored `recurringRule` field, and no task dependencies or team/queue assignment. Also surfaced a **cross-cutting finding not specific to this feature**: the codebase's own comments confirm 3 known-missing CRM automation trigger call sites (`lead.updated`, `lead.qualified`, `campaign.member_responded`) — this should be added to the module-wide gap list, not just F015's.
