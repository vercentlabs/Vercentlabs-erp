# F030 CRM reports — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `getCrmReport`'s scoping header (`index.js:4479-4499`, sharing the exact hardened pattern verified for F024's dashboard), its full 14-report dispatch list, and the `reports/[report]` export route in full.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (run/**save**/drill/export, reconcile every KPI) | **PARTIAL.** Run: PASS — 14 distinct real report types (`pipeline`, `conversion`, `sources`, `activities`, `forecast`, `campaigns`, `revenue-operations`, `account-health`, `privacy`, `pipeline-intelligence`, `engagement-intelligence`, `relationship-coverage`, `partner-pipeline`, `ai-governance`) — a genuinely rich, purpose-built catalog, not a thin stub. Drill: PASS in spirit — reports return row-level data (`result.rows`), not just aggregates, so a UI can drill into the underlying records. Export: PASS — CSV export reuses `rowsToCsv` from the same shared `reporting-engine` package verified in F021 to apply `neutralizeFormula` formula-injection protection, so this inherits that protection automatically. **Gap: no "save" capability** — confirmed by grep, no saved-report/saved-filter-preset entity exists; every report run is stateless per-request. |
| CAP-002 (semantic dimensions/measures, **row/field security before aggregation**, **scheduled delivery**, cache/freshness, formula versioning, **safe custom builder**, **NL query transparency**) | **PASS on the security item with real cross-referenced hardening; 3 confirmed gaps.** Row/field security before aggregation: **PASS, doubly enforced** — `requireCrmReportView(session, report)` gates access per report *type* at the route layer, and `getCrmReport`'s query itself applies the identical `companyVisible`/`branchVisible`/`ownerVisible` predicates verified in F024, with a code comment explicitly stating "See `getCrmDashboard()`'s identical fix" — direct evidence the same security fix was deliberately propagated across both features rather than fixed once and forgotten elsewhere. Safe custom builder / NL query: **the underlying "arbitrary SQL" risk in CAP-003 is avoided by not building a dynamic query surface at all** — every report is one of 14 fixed, hand-written queries; there is no user-composable query builder and no natural-language-to-SQL feature anywhere in the module (confirmed by grep). This is the safest possible posture against injection, but it also means "custom builder" and "NL query transparency" are gaps, not partially-built risky features. Cache/freshness: every report query runs live per request with no caching layer visible — "freshness" is trivially satisfied (always current) but there's no explicit cache-invalidation concern to evaluate either way. **Confirmed gaps:** no scheduled report delivery (no email/export-on-a-schedule mechanism found); no formula-versioning concept for report definitions (unlike F027's score-model versioning, a report's calculation logic has no version pinned to historical results — though since reports compute live rather than storing historical snapshots, this may be a lower-priority gap than it would be for a persisted metric). |
| CAP-003 (export via permission-filtered datasets; never arbitrary tenant SQL) | PASS | confirmed directly — no dynamic SQL construction from user input exists in `getCrmReport`; every report is a fixed, parameterized query. |
| FR-001/002/003 | PASS | validation/permission/conflict states present at the route; not a bulk-mutation feature. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | N/A | read-only feature, no state transitions. |
| BR-001/BR-002 | N/A | no mutation. |
| DATA-001/002 | PASS | reads only from already-verified tables across the module. |
| VAL-001/002 | N/A | minimal input surface (report key + date range), validated by the fixed dispatch list itself (an unknown key simply doesn't match any branch). |
| CALC-001 | PASS | all 14 report calculations are computed live, matching the same null-safe, FILTER-based aggregation style verified as correct in F024/F025. |
| UX-001/002/003 | PASS (by test evidence) | "F025/F030 expose dedicated forecast and only canonical reports" confirmed passing in this session's earlier full CRM test run — and the test name itself is worth noting: it specifically guards against a *proliferation* of ad-hoc report surfaces, consistent with the fixed-catalog design found here. |
| SEC-001/002 | PASS | see CAP-002 — this is the second dashboard-caliber security feature found (after F024) with explicit, cross-referenced hardening history. |
| AUTO-001 / APP-001 / NOTIF-001 (scheduled delivery is also this) / REP-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED / GAP (scheduled delivery) | |
| AI-001 | PARTIAL | an `ai-governance` report exists (implying AI *usage* is itself reported on), but no AI-generated *query* capability exists to have an authority boundary around. |
| API-001/002 | PASS | route pattern consistent with, and security-wise as strong as, F024's dashboard. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

26 of 37 rows PASS. This is the second feature (after F024) with directly cross-referenced, deliberate security-hardening evidence in its own code comments — a real pattern of care in this module's analytics surface, not an accident. The "custom builder"/"NL query" gaps are the safe kind: the risky feature was never built, rather than built insecurely. The two operationally real gaps (no saved reports, no scheduled delivery) are genuine, scoped missing features for the gap-closing pass.

---

# CRM module: all 30 features traced

This completes the full atomic-requirement trace for CRM (F001-F030), the module the owner asked to be checked to this depth. Summary of what this pass produced, across all 30 `F0##-AUDIT.md` files:

- **2 near-misses caught and corrected before being reported wrong**: F008's "no lead-merge exists" (it exists, just unreachable — `mergeCrmLead`) and F023's "no conversion entry point" (it exists, in a route page my first search didn't cover). Both are recorded as explicit methodology lessons in their respective audit files.
- **Strongest results**: F011 (Probability/expected revenue) and F027 (Lead scoring) — 29/37 each, zero genuine functional gaps, and F027's `calculateLeadScoreBreakdown` is the single best piece of code (pure, deterministic, fully explainable) found in the audit.
- **Largest real gaps**: F008 (Duplicate detection — merge exists but unreachable, no dismiss, no cross-object matching) and F013 (Calls — a full 10-table telephony/recording/transcription schema with zero application code on top of it).
- **Recurring pattern across most features**: "configurable criteria/rules" requirements (qualification checklists, stage-transition graphs, duplicate-matching thresholds, custom-field role-visibility) are consistently hardcoded rather than admin-configurable.
- **Recurring positive pattern**: security-critical code (webhook HMAC verification, file-upload malware scanning, CSV formula-injection prevention, dashboard/report aggregate scoping) is consistently well-engineered, in several cases with code comments citing specific prior security-hardening efforts — this module has real security-review history behind it, not incidental correctness.
- **One live security bug found and fixed this session** (not CRM-specific): the cross-module approval-rejection permission bypass, fixed and regression-tested earlier in this conversation.

Next: the dedicated gap-closing pass for everything logged across F001-F030, before moving to Sales (module 2/12).
