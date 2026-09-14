# F090 Supplier rating — Atomic requirement trace

Dossier: weighted supplier ratings/scorecards from governed operational and
questionnaire/manual criteria, with review, overrides, peer comparison,
historical versions. Lifecycle: `DRAFT SCORECARD -> REVIEWED -> APPROVED/
PUBLISHED -> SUPERSEDED`.

`supplier-scorecards` is a generic child resource of `suppliers`. UI:
`pass1-operations-workspace.tsx`'s `record-supplier-scorecard` action
(overallScore, qualityScore, deliveryScore, commercialScore, period, note
— all raw number inputs).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (scorecard capture) | PASS (minimal) | A scorecard with sub-scores and a period can be recorded through a real form, permission-gated (`procurement.suppliers.qualify`), company-validated against its parent supplier. |
| **CAP-001 — "weighted" rating from criteria — the exact gap already found in F072.** | **Confirmed, repeated finding.** `evaluateSupplierScore(weights, scores)` is a real, correct, decimal-safe weighted-allocation function — never called. `overallScore` is typed directly by a human on the form (`field("overallScore", "Overall score", "number")`); the `qualityScore`/`deliveryScore`/`commercialScore` sub-scores are captured but nothing combines them into `overallScore` via any weighting formula — a user could enter an `overallScore` of 90 with sub-scores of 10 each, and nothing would catch the inconsistency. |
| **CAP-002 — review/approval before publish.** | **GAP, confirmed absent.** Scorecards are generic child resources created with a fixed `status: "active"` — there is no `draft -> reviewed -> approved/published -> superseded` state machine; a scorecard exists the moment it's created, with no review gate. |
| **CAP-002 — peer comparison.** | **GAP.** No cross-supplier comparison view was found; `getProcurementReport("supplier-performance")` lists suppliers with their average score independently, which is a *list*, not a comparative ranking/percentile view. |
| **CAP-002 — historical versioning / supersession.** | PARTIAL | The generic child-resource optimistic-version counter exists, but there's no explicit "supersede, keep prior versions visible as history" semantic — an update just overwrites in place (with a version bump), and `governance.js`'s scorecard lookup always takes the single latest row (`ORDER BY created_at DESC LIMIT 1`), so prior scorecards become invisible to the health check even though the rows presumably still exist in the table. |
| SEC-001 | PASS | Standard scoping. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

Same root finding as F072: the module has a correct, ready-to-use
deterministic scoring function that nothing calls. A scorecard today is
purely manual data entry with no review workflow, no weighting
enforcement, and no real comparison UI. Wiring `evaluateSupplierScore`
into the scorecard-create form (compute `overallScore` from the sub-scores
and a configured weight set, rather than accepting it as free input) would
be a small, high-value fix for the gap-closing pass.
