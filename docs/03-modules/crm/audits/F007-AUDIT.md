# F007 Lead stages and statuses — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). Implementation is `lead-lifecycle.js` (376 lines, read in full during the F001 audit — this file is F007's real home, not F001's) plus `lead-stages` / `leads/[id]/stage` API routes.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | `transitionLeadStage` moves a lead only along declared transitions, with note/reason and full history (`crm_lead_stage_events`). |
| CAP-002 (transition graph, required fields, **dwell SLA**, reactivation, **reason codes**, live-config migration, concurrency) | **PARTIAL — several real gaps.** Concurrency: PASS (`FOR UPDATE OF lead` + `expectedUpdatedAt` check, already confirmed in F001's audit). Transition graph: exists as a real table (`crm_lead_stage_transitions`) and is enforced (`transitionLeadStage` rejects any pair not present in it) — **but the graph is auto-generated as bidirectional adjacency between consecutive active stages** (`rebuildLeadStageTransitions`, `:102-132`: `pairs.push([active[i].id, active[i+1].id], [active[i+1].id, active[i].id])`), not an intentionally curated directed graph with real business asymmetry. Any two adjacent stages can be freely moved between in either direction — there's no way to configure a one-way-only transition (e.g., allow New→Working but forbid Working→New). This only partially satisfies "declared transitions are legal": transitions are declared, but the declaration process can't express direction-specific business rules. **Gaps:** no dwell-SLA (time-in-stage) alerting/timer anywhere in this file or `lead-operations.js`; no fixed reason-code vocabulary for stage transitions — `note` is free text only (contrast with F006's `LEAD_UNQUALIFICATION_REASONS`); no live-stage-configuration-migration tooling — deactivating a stage (`setLeadStageActive`) does not move leads currently sitting in it, they simply remain at that stage code with no forced migration path. |
| FR-001/002/003 | PASS | full workflow with validation/permission/conflict states; `listLeadStages`/`listLeadStageHistory` are bounded (`LIMIT 200` on history — acceptable, no offset pagination beyond that, which is a minor FR-003 concern at very high stage-change volume for one lead, unlikely in practice). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001 (configured directed graph, only declared transitions legal) | PARTIAL | see CAP-002 — declared and enforced, but not truly directional. |
| FLOW-002 | PASS | `lifecycleError` maps constraint violations to stable codes; `CRM_LEAD_STAGE_TRANSITION_INVALID`/`CRM_LEAD_STAGE_CONFLICT` are specific and actionable. |
| BR-001/BR-002 | PASS | single transition path; stage events are insert-only; `governed` fields (`id`,`code`,`status`,`isSystem`,`isInitial`,`organizationId`) are explicitly blocked from direct edit (`normalizeStageInput`, `:38-44`). |
| DATA-001/002 | PASS | `crm_lead_stages`, `crm_lead_stage_transitions`, `crm_lead_stage_events` all exist and are used exactly as read; events retain `from_stage_code`/`to_stage_code` snapshots even if the stage is later renamed. |
| VAL-001/002 | PASS | name/description/sort-order validated server-side with length limits and stable `CRM_LEAD_STAGE_*` codes. |
| CALC-001 | N/A | no monetary/derived value. |
| UX-001/002/003 | PASS (by test evidence) | `crm-lead-lifecycle-f007.test.mjs` exists both sides and passes. |
| SEC-001 | PASS | `PERMISSIONS.crmSettingsManage` gates stage configuration; `PERMISSIONS.crmLeadsManage` gates per-lead stage moves; `scopedLeadWhere` enforces company/branch/owner scope in `listLeadStageHistory`/`transitionLeadStage`. |
| SEC-002 | PASS | history notes are hidden from users without `crmLeadsViewSensitive` (`listLeadStageHistory`, `:291-295`, `delete value.note` when not sensitive-eligible) — already observed in F001's audit, applies equally here. |
| AUTO-001 (CAP-003: stage changes may trigger automation but remain CRM-owned) | NOT INDEPENDENTLY VERIFIED | `queueOutboxEvent` fires `crm.lead.stage_changed`, which is the correct integration point for downstream automation, but did not trace an actual consuming automation rule this pass. |
| APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | route-level pattern already verified for this route family. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

23 of 37 rows PASS, 2 PARTIAL (transition graph is adjacency-based rather than a truly curated directed graph; the primary flow inherits the same limitation), 3 genuine gaps specific to this feature (no dwell-SLA, no reason-code vocabulary for transitions, no live-config migration tooling when a stage is deactivated while leads still occupy it).
