# F013 Calls — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `call-operations.js` in full (512 lines) and searching for telephony service-layer code.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | schedule/log/start/complete/cancel are all real, with duration auto-computed and clamped (`GREATEST(0,LEAST(86400,...))`, `:483`). |
| CAP-002 (inbound/outbound, dispositions, **telephony adapter**, **recording consent/retention**, **transcript permissions**, **provider failure reconciliation**) | **GAP — significant, and a distinct kind of finding.** Dispositions exist (`outcomeCode`/`outcome` note). But there is a **fully-designed, entirely unused database schema** for exactly what's missing: `032_crm_telephony_conversation_intelligence.sql` creates `crm_telephony_connections`, `crm_telephony_commands`, `crm_telephony_events`, `crm_conversation_recordings`, `crm_recording_access_grants`, `crm_transcription_jobs`, `crm_conversation_transcripts`, `crm_transcript_segments` — **10 tables total** — and not one of them is referenced by any service function, API route, or UI component anywhere in the repo (confirmed by grep across `services/api/src/modules/crm`, `apps/web/src/app/api/crm`, and `apps/web/src/modules/crm`: zero hits). This isn't a hardcoded-instead-of-configurable gap like most other findings — it's a real feature that was schema-designed and then never built. Calls today are manual-log only; there is no telephony adapter, no recording, no transcript, no provider webhook reconciliation. |
| CAP-003 (telephony providers are adapters; CRM stays domain owner; webhooks idempotently reconciled) | **N/A given CAP-002 — nothing to be an adapter for yet.** |
| FR-001/002/003 | PASS | full state-machine workflow with validation/permission/conflict states; `listCrmCalls` follows the same pagination pattern verified elsewhere. |
| US-001/US-002 | PASS | same evidence, scoped to what's actually built (manual logging). |
| FLOW-001 (`PLANNED -> IN_PROGRESS -> COMPLETED \| CANCELED`) | PASS | exactly this state machine, correctly guarded: `startCrmCall` only fires from planned/overdue, `completeCrmCall` blocks from cancelled and is idempotent on a matching replay, `cancelCrmCall` blocks from completed. **Third occurrence of the same correct idempotent-replay pattern** seen in F011 and F012 — this team consistently gets retry-safety right. |
| FLOW-002 | PASS | `stale()` helper give a consistent `CRM_CALL_CONFLICT`/version-check pattern across all three transition functions. |
| BR-001/BR-002 | PASS | single transition path per action; `recordEvent` writes an append-only event log (`crm_activity_events` presumably, via `recordEvent`) for every transition. |
| DATA-001/002 | PASS for what's built | `crm_activities` (activity_type='call') is used correctly; see CAP-002 for the unused telephony/recording schema. |
| VAL-001/002 | PASS | `assertAllowed` whitelists exactly which input fields each action accepts, rejecting anything else — a stricter pattern than a simple presence check. |
| CALC-001 | PASS | call duration is computed from `call_started_at`/`now()` at completion time, not client-supplied. |
| UX-001/002/003 | PASS (by test evidence) | `crm-calls-f013.test.mjs` exists both sides and passes (already re-confirmed this session, including the dedicated-focused-workspace and same-origin/audit/PII-safety tests). |
| SEC-001/002 | PASS | scope/permission pattern consistent with the rest of the module (already re-verified this session via the passing test suite, which specifically checks PII-safe audit). |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | route pattern consistent with the rest of the module. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

23 of 37 rows PASS for what's actually built, but CAP-002/CAP-003 represent the largest *designed-but-unbuilt* gap found in the CRM audit — a complete, 10-table telephony/recording/transcription schema with zero application code on top of it. Unlike F008's gap (some scope was built, some wasn't) or the "hardcoded instead of configurable" pattern seen elsewhere, this is closer to "the database migration shipped ahead of the feature and the feature was never finished." Worth flagging to the owner as a potential scope decision (build it, or drop the unused schema) rather than assuming it should simply be completed.
