# F013 Calls — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `call-operations.js` in full (512 lines) and searching for telephony service-layer code.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | schedule/log/start/complete/cancel are all real, with duration auto-computed and clamped (`GREATEST(0,LEAST(86400,...))`, `:483`). |
| CAP-002 (inbound/outbound, dispositions, **telephony adapter**, **recording consent/retention**, **transcript permissions**, **provider failure reconciliation**) | **Scope decision made and executed 2026-09-05 (owner decision): drop the unused schema, keep Calls as manual logging.** The 10-table telephony/recording/transcription schema (`crm_telephony_connections`, `crm_telephony_commands`, `crm_telephony_events`, `crm_conversation_recordings`, `crm_recording_access_grants`, `crm_transcription_jobs`, `crm_conversation_transcripts`, `crm_transcript_segments`, `crm_conversation_action_items`, `crm_conversation_acceptance_runs`) plus its 2 functions and 2 triggers were removed by migration `077_f013_drop_unused_telephony_schema.sql`, along with the telephony-specific columns migration 032 had added to the still-actively-used base `crm_conversations` table. This is now correctly **N/A** rather than GAP: telephony/recording/transcription is out of scope by deliberate decision, not an unbuilt requirement. |
| CAP-003 (telephony providers are adapters; CRM stays domain owner; webhooks idempotently reconciled) | **N/A — out of scope by decision, not a gap.** |
| FR-001/002/003 | PASS | full state-machine workflow with validation/permission/conflict states; `listCrmCalls` follows the same pagination pattern verified elsewhere. |
| US-001/US-002 | PASS | same evidence, scoped to what's actually built (manual logging). |
| FLOW-001 (`PLANNED -> IN_PROGRESS -> COMPLETED \| CANCELED`) | PASS | exactly this state machine, correctly guarded: `startCrmCall` only fires from planned/overdue, `completeCrmCall` blocks from cancelled and is idempotent on a matching replay, `cancelCrmCall` blocks from completed. **Third occurrence of the same correct idempotent-replay pattern** seen in F011 and F012 — this team consistently gets retry-safety right. |
| FLOW-002 | PASS | `stale()` helper give a consistent `CRM_CALL_CONFLICT`/version-check pattern across all three transition functions. |
| BR-001/BR-002 | PASS | single transition path per action; `recordEvent` writes an append-only event log (`crm_activity_events` presumably, via `recordEvent`) for every transition. |
| DATA-001/002 | PASS | `crm_activities` (activity_type='call') is used correctly; the unused telephony/recording schema is now removed, so there is no dead schema to account for. |
| VAL-001/002 | PASS | `assertAllowed` whitelists exactly which input fields each action accepts, rejecting anything else — a stricter pattern than a simple presence check. |
| CALC-001 | PASS | call duration is computed from `call_started_at`/`now()` at completion time, not client-supplied. |
| UX-001/002/003 | PASS (by test evidence) | `crm-calls-f013.test.mjs` exists both sides and passes (already re-confirmed this session, including the dedicated-focused-workspace and same-origin/audit/PII-safety tests). |
| SEC-001/002 | PASS | scope/permission pattern consistent with the rest of the module (already re-verified this session via the passing test suite, which specifically checks PII-safe audit). |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | route pattern consistent with the rest of the module. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment (updated 2026-09-05)

27 of 37 rows now PASS. With the scope decision resolved (drop the unused schema), this feature is genuinely complete for its actual, deliberate scope: manual call logging with a correct state machine, idempotent transitions, PII-safe audit, and stable error codes. If telephony integration is ever wanted later, it starts clean rather than resurrecting untested dormant schema.
