# F024 Pipeline dashboard — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `getCrmDashboard` (`index.js:4418-4458`) in full and cross-checking the actual dashboard route (`apps/web/src/app/api/crm/dashboard/route.ts`) against a second, similarly-named but unscoped function.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | pipeline value, open-opportunity count, weighted pipeline, overdue/due-today activity counts, lead/conversion counts — all real, all drill-linked to `/crm/pipeline`, `/crm/leads`, `/crm/activities`. |
| CAP-002 (metric formulas, currency, filters, stale/risk signals, target coverage, cache freshness, drilldown reconciliation, **aggregate security**) | **PASS on aggregate security — and worth a specific note.** `getCrmDashboard`'s query (`:4435-4444`) applies `companyVisible`/`branchVisible`/`ownerVisible` predicates to **every single sub-query** (leads, qualified leads, open opportunities, pipeline value, weighted pipeline, overdue activities, due-today, leads-this-month, conversions-this-month) — none of them are left unscoped. The code comment at `:4427-4434` references a **specific prior security fix** (a company-switcher bug where an org owner's dashboard didn't respect the actively-selected company) and another comment at `:4439-4442` explicitly cites a security-hardening document ("CRM Analytics Security") for why owner-scoping mirrors `recordScope()` exactly — this is a feature with a real, documented security-hardening history, not just incidental correctness. Currency: PASS — `currency_code` is read from the organization's `base_currency`. Drilldown: PASS in spirit — dashboard metrics link to `/crm/pipeline`/`/crm/leads`/`/crm/activities`, which apply the same scoping rules, though the links aren't pre-filtered query strings reproducing the exact number (a minor reconciliation gap, not a security one). **Not confirmed:** stale/risk signals surfaced specifically on the dashboard (as opposed to inside the pipeline board, already covered by F010's gap), target/quota coverage display, or cache-freshness behavior (is this computed fresh per request, or cached? The route calls the query directly per request with no caching layer visible, which answers "freshness" as "always fresh" but means there's no explicit cache-invalidation concern to verify either way). |
| CAP-003 (reads CRM read models only; BI export uses governed report definitions) | PASS | no write statement anywhere in `getCrmDashboard`. |
| FR-001/002/003 | PASS | states covered; this is a read-only aggregate query, not a bulk-volume concern. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | N/A | read-only feature, no state transitions of its own. |
| BR-001/BR-002 | N/A | no mutation. |
| DATA-001/002 | PASS | reads only from already-audited tables (`crm_leads`, `crm_opportunities`, `crm_activities`, `crm_conversion_records`). |
| VAL-001/002 | N/A | no input to validate beyond session context. |
| CALC-001 | PASS | every figure is a live aggregate query, not a stored/mutable derived field. |
| UX-001/002/003 | PASS (by direct read) | confirmed real `Link` elements wrapping every headline metric, not static numbers. |
| SEC-001/002 | **PASS, and the standout finding of this row.** | see CAP-002. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | N/A | not applicable to a read-only dashboard. |
| API-001/002 | PASS | route requires only baseline `requireCrmView` — correctly relies on the query's own per-row scoping rather than gating the whole endpoint behind a broader permission, which is the right design (a restricted rep should see *their own* dashboard, not be blocked from having one). |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## A near-miss worth recording

`opportunity-operations.js` has a **separate, similarly-named function `getOpportunityDashboard` that is not scoped at all** (`WHERE o.organization_id=$1 AND o.status <> 'archived'`, no company/branch/owner predicate) — if this were the function wired to the dashboard route, it would leak org-wide pipeline totals to any CRM user regardless of their actual record scope. Confirmed via grep that **it has zero callers anywhere in the codebase** — it's unused, not a live vulnerability. Still worth flagging: an unscoped, dead function with a name almost identical to the real, correctly-scoped one sitting in a different file is exactly the kind of thing that gets accidentally wired up later by someone who doesn't know the difference. Recommend deleting `getOpportunityDashboard` (or renaming/consolidating it into `buildPipelineSummary` usage that's actually scoped) in the gap-closing pass, purely as a footgun-removal measure, not because anything is broken today.

## Net assessment

26 of 37 rows PASS. This feature's real, live security posture is excellent, with genuine evidence of a prior hardening pass rather than accidental correctness. The one actionable item is housekeeping (remove or fix the unused unscoped duplicate function), not a live defect.
