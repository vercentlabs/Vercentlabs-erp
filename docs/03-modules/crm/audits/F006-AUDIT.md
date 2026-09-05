# F006 Lead qualification — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `lead-qualification.js` in full (321 lines) and the qualification API route.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CAP-003 | PASS | `decideLeadQualification` records a defensible decision with mandatory reason on disqualification; qualification state is read (not re-created) by F022 conversion, no downstream records created here. |
| CAP-002 (**configurable criteria/playbooks**, exception override, disqualification reasons, evidence timestamps, strict separation from F027) | **PARTIAL — 1 genuine gap.** Disqualification reasons are a governed, fixed vocabulary (`LEAD_UNQUALIFICATION_REASONS`, `:7-18`) with a required free-text explanation when `other` is chosen — good. `qualification_decided_at`/`decided_by_user_id` give evidence timestamps. Separation from F027 scoring is real — `evaluateLeadQualificationReadiness` never reads `score`/`lead_grade`. **But the readiness criteria (`required`: identity, contact; `recommended`: company, job title, product interest, estimated value, source) are hardcoded in JS (`:117-150`), not loaded from any configuration table** — there is no admin-configurable criteria/playbook system despite the dossier explicitly requiring one. "Exception override" exists implicitly (a manager with `crm.leads.manage` can still decide even if `readiness.ready` is false, since the readiness gate only blocks the `qualified` decision, not `unqualified`) but there's no explicit override audit trail beyond the normal decision event. |
| FR-001/002/003 | PASS | full decision workflow with validation/permission/conflict states; history via `qualificationHistory` (`LIMIT 100`, no pagination beyond that cap — acceptable at this volume). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001 (`NOT_STARTED -> IN_PROGRESS -> QUALIFIED or DISQUALIFIED`, requalification creates new event) | PASS (minor naming difference, not a gap) | Real states are `not_reviewed`/`qualified`/`unqualified` (`LEAD_QUALIFICATION_STATES`, `:1-5`) — there is no separately-tracked "IN_PROGRESS" state, since qualification is a single-step decision rather than a multi-stage form; "in progress" is better read as a UI concept (viewing readiness before deciding) than a stored state. **Requalification is correctly a distinct event type**: transitioning `unqualified -> qualified` emits `crm.leads.requalified` specifically (`:301-303`), not a generic state-change event — this is exactly what the dossier asks for. |
| FLOW-002 | PASS | `scopedLead(..., lock=true)` takes `FOR UPDATE OF lead` before deciding (`:229`), preventing a concurrent double-decision race; stable `CRM_LEAD_QUALIFICATION_*` error codes throughout. |
| BR-001/BR-002 | PASS | single decision path (`decideLeadQualification`); `assertNoQualificationMutation` (`:104-115`) explicitly blocks any generic-edit path from touching qualification fields directly — this is the same governance pattern already confirmed from the CRM-record-scope test in F001's audit. History events are insert-only. |
| DATA-001/002 | PASS | `crm_leads.qualification_*` columns and `crm_lead_qualification_events` both exist and are used exactly as read; reason/note/decided-by are retained on the event row even if the lead's current state later changes again. |
| VAL-001/002 | PASS | decision value, reason code (against the fixed vocabulary), and the `other`-reason minimum length are all validated server-side with stable codes and field-scoped error objects. |
| CALC-001 | N/A | no monetary/derived calculation in this feature. |
| UX-001/002/003 | PASS (by test evidence) | `crm-lead-qualification-f006.test.mjs` exists both sides and passes. |
| SEC-001 | PASS | `assertCanDecide` requires `crm.leads.manage` (or org owner) in the domain layer (`:61-72`) in addition to route-level `crmLeadsManage`; `addScope` (`:74-93`) enforces company/branch/owner scope — double-enforced, not just route-level. |
| SEC-002 | PASS | the route additionally requires `PERMISSIONS.crmLeadsViewSensitive` just to **view** qualification data/reasons, not only to decide — a stricter gate than plain record visibility, which is exactly what SEC-002 asks for. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | route-level permission/audit pattern already verified for this route family. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

27 of 37 rows PASS with cited evidence. 1 genuine gap: no configurable qualification-criteria/playbook system despite the dossier explicitly requiring one — the readiness checklist is hardcoded. This is otherwise one of the more tightly-built features so far: correct concurrency locking, correct requalification-as-distinct-event semantics, and a genuinely stricter-than-baseline permission gate on viewing qualification data.
