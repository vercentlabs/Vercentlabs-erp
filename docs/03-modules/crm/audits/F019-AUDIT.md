# F019 Activity timeline — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). No dedicated timeline service/component exists — F019 is realized as a client-side merge of multiple already-verified data sources (`getLeadTimeline` from F001's audit, plus stage/qualification/communication history) inside `lead-detail-workspace.tsx`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | the merged timeline (`useMemo<TimelineEvent[]>`, `lead-detail-workspace.tsx:306`) draws only from sources already individually permission-scoped (activities, conversions, assignments, stage/qualification history — each independently verified in F001/F006/F007's audits to enforce scope/redaction server-side before reaching the client). |
| CAP-002 (system vs human events, **cursor stability**, per-item authorization, mixed visibility, **virtualized history**, **cited AI summaries**) | **PARTIAL — 3 concrete gaps.** Per-item authorization/mixed visibility: PASS — this is inherited correctly, not re-implemented insecurely; e.g. `listLeadStageHistory` already strips `note` server-side for non-sensitive-eligible viewers (confirmed in F001's audit) before the event ever reaches this merge. System vs human events: PASS in substance — event rows carry `changed_by_user_id`/`actor_user_id` which can be null for system-originated transitions, giving the UI what it needs to distinguish them (did not confirm the UI visually labels this distinction, but the data supports it). **Gaps:** there is no cursor-based pagination anywhere in the timeline data path — `getLeadTimeline` and its siblings return a **fixed top-100/200 rows per sub-source** (`LIMIT 100`/`LIMIT 200`, confirmed in F001's audit of the same function), merged and rendered with a plain `.map()`, not a virtualized list. For a genuinely high-activity record (a lead worked for years with hundreds of interactions), events older than the fixed cap are simply invisible — there is no "load more"/cursor to reach them, and "virtualized history" (rendering large lists efficiently) doesn't apply because the list is capped rather than actually large-scale. No cited AI summary feature exists anywhere. |
| CAP-003 (timeline reads, never mutates source records) | PASS | every function involved (`getLeadTimeline` et al.) is read-only; confirmed directly in F001's audit of the same code. |
| FR-001/002/003 | **PARTIAL** | success/empty states exist (`"No timeline events yet."`, `:1293`); **FR-003's enterprise-volume requirement is the same gap as CAP-002's cursor/virtualization finding** — a record with more history than the fixed per-source cap has no way to see the rest. |
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

## Net assessment

This feature is architecturally sound (compose, don't re-implement, permission logic — a good pattern) but has one real, scoped gap that shows up under two different requirement IDs: there is no way to see timeline history beyond each source's fixed cap (100-200 rows), because there's no cursor/pagination mechanism, only a flat merge-and-render. This will only manifest on very long-lived, high-activity records, but it is a genuine FR-003/CAP-002 gap, not just a documentation nuance. AI-cited-summary is a clean, expected gap consistent with the module-wide AI pattern.
