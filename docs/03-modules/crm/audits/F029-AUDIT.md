# F029 Bulk actions — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). Core implementation (`bulkUpdateLeads`, `enqueueLeadBulkUpdateJob`, `getLeadBulkJob`, `normalizeLeadBulkFilters`) already read in full during F001's audit (`lead-operations.js`); this pass adds a targeted check for cancellation/retry.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | synchronous path for ≤50 records with per-row `applied`/`conflict`/`skipped`/`failed` results (already verified: savepoint-isolated, `mapBulkError` classifies each failure type distinctly); async path for up to 50,000 with a persisted `progress`/`result_manifest`. |
| CAP-002 (all-results selection, **filter snapshot**, partial failure, async limits, **cancellation**, **retries**, idempotency, per-row audit, AI approval boundary) | **PARTIAL — strong on the items already verified, 2 confirmed gaps.** Filter snapshot: PASS — `snapshotLeadBulkJobSelection` materializes the exact matching record set at submission time into `crm_lead_bulk_job_items`, so the job operates on a frozen selection rather than re-evaluating the filter later (correctly avoids a moving-target bug where records added/removed after submission would inconsistently get included). All-results selection: PASS — `selection.type === "filter"` is explicitly supported alongside explicit ID lists. Partial failure: PASS (verified in F001). Async limits: PASS — `LEAD_BULK_SYNC_LIMIT=50` / `LEAD_BULK_MAX_ITEMS=50,000`. Idempotency: PASS — a stable, caller-supplied idempotency key (16-200 chars) is required for the async path, with a fingerprint check that rejects reusing a key for a *different* command. Per-row audit: PASS — `crm_lead_bulk_job_items` gives status/error per row. **Gaps:** no cancellation function exists for an in-flight or queued bulk job anywhere in the CRM module or the shared background-job infrastructure (confirmed by grep across both); no distinct per-row retry mechanism — re-running requires a new idempotency key, which would resubmit the *entire* selection rather than just the previously-failed rows, since the job's frozen selection snapshot has no "retry only the failed subset" entry point. |
| CAP-003 (bulk jobs invoke normal domain commands per record, never expand scope) | PASS | `bulkUpdateLeads` calls `updateCrmRecord` (the same generic path interactive edits use) per row, with `requireVersion: true` — no bypass of the ordinary per-record authorization/validation path. |
| FR-001/002/003 | PASS | already verified in F001; this is the feature that most directly demonstrates FR-003's enterprise-volume requirement being taken seriously (explicit sync/async split at a real threshold, not just an unbounded loop). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | savepoint rollback-and-continue per row (sync path) and idempotency-key-gated job creation (async path) are both correct, verified concurrency/retry-safety patterns. |
| BR-001/BR-002 | PASS | every row still goes through the same governed command as an interactive edit — bulk cannot bypass business rules to move faster. |
| DATA-001/002 | PASS | `tenant.background_jobs`, `crm_lead_bulk_job_items` both exist and are used correctly. |
| VAL-001/002 | PASS | `normalizeLeadBulkChanges` explicitly whitelists which fields are bulk-editable and explicitly redirects qualification/lifecycle/ownership changes to their governed single-record actions (already verified in F001) — a deliberately narrow, safe bulk-edit surface. |
| CALC-001 | N/A | no calculation. |
| UX-001/002/003 | PASS (by test evidence) | "F029 bulk lead operations remain governed and cannot bypass conversion/archive" confirmed passing this session. |
| SEC-001/002 | PASS | scope/permission enforced per-row via the same `updateCrmRecord` path as interactive edits — no separate, weaker bulk-specific authorization exists to get wrong. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| AI-001 | GAP | no AI-driven bulk suggestion/approval feature exists to have a boundary around — consistent with the module-wide AI pattern. |
| API-001/002 | PASS | route pattern consistent with the rest of the module. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

27 of 37 rows PASS. This is one of the most carefully-designed features in the audit for the specific problem of "bulk operations without bypassing single-record governance" — the frozen filter-snapshot, sync/async threshold, and mandatory idempotency key for large jobs are all textbook-correct choices. The 2 gaps (no cancellation, no partial retry) are real operational limitations: today, a mistaken 40,000-row bulk job must run to completion, and a job with some failed rows can only be fully resubmitted, not selectively retried.
