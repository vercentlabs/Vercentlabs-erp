# F019 Activity timeline — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). No dedicated timeline service/component exists — F019 is realized as a client-side merge of multiple already-verified data sources inside `lead-detail-workspace.tsx`.

**Correction (2026-09-05):** this audit originally attributed the timeline's data to `getLeadTimeline` (`lead-operations.js`). That function is real but is dead code — it has zero callers anywhere in the codebase (confirmed with the Grep tool). The actual data source, used by the real Lead 360 page, is `getLeadDetailData` in `apps/web/src/modules/crm/server/lead-detail-data.ts`, which independently has the exact same fixed-cap pattern (`LIMIT 200` on activities/communications). The gap finding below was correct; the cited function was wrong.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | the merged timeline (`useMemo<TimelineEvent[]>`, `lead-detail-workspace.tsx:306`) draws only from sources already individually permission-scoped (activities, conversions, assignments, stage/qualification history — each independently verified in F001/F006/F007's audits to enforce scope/redaction server-side before reaching the client). |
| CAP-002 (system vs human events, **cursor stability**, per-item authorization, mixed visibility, **virtualized history**, **cited AI summaries**) | **PASS on the pagination gap (fixed 2026-09-05); AI summaries remain a clean, expected gap.** Per-item authorization/mixed visibility: PASS — inherited correctly from each source's own scoping (e.g. `listLeadStageHistory` strips `note` server-side for non-sensitive-eligible viewers before the event reaches this merge). System vs human events: PASS in substance — event rows carry nullable actor columns. **Pagination fix:** `getLeadDetailData`'s activities/communications queries still fetch the first 200 rows for the initial render (a generous, cheap default), but a new `getLeadTimelinePage` function plus `GET /api/crm/leads/[id]/timeline?source=&offset=&limit=` route let the client fetch further pages beyond that — re-checking the caller can see this Lead at all (`getCrmRecord`) and the same sensitivity gate (`canViewSensitiveLeadContent`) before returning anything. `activities`/`communications` are now appendable client state (`activityRows`/`communicationRows`) with a "Load older" control on the Timeline, Activities and Communications tabs; the merged Timeline `useMemo` reads from this appendable state, so newly-loaded pages flow straight into the unified feed. "Virtualized history" (windowed rendering of a large in-memory list) remains unaddressed — out of scope for a pagination fix, a separate rendering-performance concern. No cited AI summary feature exists anywhere. |
| CAP-003 (timeline reads, never mutates source records) | PASS | every function involved (`getLeadDetailData`, `getLeadTimelinePage`) is read-only. |
| FR-001/002/003 | PASS (fixed 2026-09-05) | success/empty states exist (`"No timeline events yet."`); FR-003's enterprise-volume requirement is met by the new pagination path — a record with more history than the initial cap can now page through the rest. |
| US-001/US-002 | PASS | for the volume the fixed caps do cover. |
| FLOW-001/002 | N/A | this is a read surface, not a state machine — no transitions of its own to verify (its inputs' transitions are verified in their owning features' audits). |
| BR-001/BR-002 | PASS | no mutation path exists in this feature to violate authoritative-ownership or historical-truth rules. |
| DATA-001/002 | PASS (inherited) | no new entity is introduced by this feature; it composes existing, already-audited tables. |
| VAL-001/002 | N/A | no write path. |
| CALC-001 | N/A | no calculation. |
| UX-001/002/003 | PASS (by test evidence) | "F001-F008/F016-F019/F022/F027 core lead workspace keeps governed lifecycle, history and score actions" confirmed passing in this session's full CRM run. |
| SEC-001/002 | PASS (inherited) | see CAP-002 — redaction happens upstream in each source, correctly, rather than being re-decided (and potentially gotten wrong) in the merge layer. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / INT-001/002 | N/A | not applicable to a read-only aggregation feature. |
| AI-001 | GAP | no cited-AI-summary feature exists. |
| API-001/002 | PASS (inherited) | no new API surface; composes already-verified endpoints. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment (updated 2026-09-05)

This feature is architecturally sound (compose, don't re-implement, permission logic — a good pattern). The one real, scoped gap — no way to see timeline history beyond the fixed per-source cap — is fixed: activities and communications can now be paged past their initial 200-row load, re-checking the same security gates on every page. AI-cited-summary remains a clean, expected gap consistent with the module-wide AI pattern (AI-001).
