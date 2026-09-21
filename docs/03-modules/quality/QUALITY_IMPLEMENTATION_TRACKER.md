# Quality implementation tracker

Status of the Quality module (features F308–F342, numbered as in `docs/03-modules/quality/features/`)
against real evidence. "Verified" means exercised by a test on real PostgreSQL (RLS on, explicit role
permission sets, no organization-owner bypass) — not "code exists". The feature spec files in this repo
are generic Pass-9 template boilerplate (identical structure repeated per feature, no concrete
field-level detail), so this implementation follows standard mature QMS (quality management system)
convention instead — ISO 9001-style inspection, non-conformance/disposition, CAPA and calibration —
built on top of a pre-existing, more substantial thin scaffold than the other modules had (see below).

**This is not a completion claim.** What follows is what was built and proven, and — equally important —
what is still open.

## What was already there

Unlike Support and HR's pre-existing stubs, Quality's original `services/api/src/modules/quality/index.js`
already contained one genuinely production-grade function: `releaseQualityHold` (idempotent, optimistically
versioned, partial-release-aware, row-locked against a real race with Stock). It is **reused as-is** — not
rewritten — because it is the exact contract `services/api/src/modules/stock/index.js`'s own movement gate
(`assertQualityAllowsDecrease`, inside `postStockMovement`) already depends on. That gate itself was **already
implemented** in Stock before this work started; it had no test coverage until now.

## How it was verified

| Layer | Evidence |
|---|---|
| Domain on real Postgres (RLS on, explicit permission sets, no owner bypass) | `tests/integration/quality-{inspections,nonconformance,management}.test.mjs` — 25 subtests |
| **F323's hard cross-module requirement**, specifically | A real call into Stock's own `postStockMovement` (not a mock) is blocked while a Quality hold covers the quantity, and succeeds once released — proven in `quality-nonconformance.test.mjs` |
| Combined regression with the rest of the platform | `node --test tests/integration/quality-*.test.mjs tests/integration/support-*.test.mjs tests/integration/hr-*.test.mjs`: 123 pass, 0 fail |
| Static gates | route-security matrix (0 unexplained gaps — `qualityMutation`/`qualityRead` registered as audited wrappers), billing-mutation gate, eslint on every touched file, `tsc --noEmit` |

**Not done this pass:** a real-browser (Playwright) end-to-end journey, the same gap already recorded for
Support. Priority went to a thoroughly tested domain layer (25 subtests, including the module's single
hardest, most consequential requirement — F323) and a fully wired, statically-verified web layer.

## Defects found by running against a real database (and fixed)

1. **`quality_sampling_plans`'s uniqueness was scoped to `code` alone**, but a real AQL sampling table is
   a *family* of lot-size brackets sharing one code (e.g. code `AQL65` covering 1–50, 51–500, ...) — the
   original constraint made a second bracket under the same code impossible. Fixed with a follow-up
   migration scoping uniqueness to `(code, lot_size_from)` instead.
2. **A NUMERIC column read back from Postgres is a string** (`"20.000000"`), and `completeInspection`'s
   AQL acceptance-number lookup bound that string directly into an INTEGER-typed comparison, failing with
   a Postgres type error on every AQL-sampled completion. Fixed by converting to a number first.
3. **Two self-approval "escape hatch" bugs, both genuine design mistakes, not test issues:**
   `approveUseAsIs`'s own top-level gate already requires `quality.manage`, so its escape-hatch check
   ("skip the self-block if the caller holds `quality.manage`") could never actually fire for anyone who
   passed the gate — self-approval of a use-as-is risk-acceptance decision was never really blocked.
   `verifyCapa` had the same shape of problem for CAPA effectiveness verification. Both are now
   **unconditional** self-blocks: there is no legitimate "manager override" for either an
   accept-known-nonconforming-product decision or an independent effectiveness check — allowing one
   defeats the entire purpose of a second person's sign-off, which is precisely why these two actions
   exist as separate, permissioned steps in the first place.
4. Test-authoring bugs caught and fixed on first run: the Stock-gate quantity math in the tests (Stock
   only blocks a movement *larger than what's available outside the hold*, not every movement while any
   hold exists at all); a missing `idempotencyKey` on every `releaseQualityHold` test call (required,
   unconditionally, by the reused function); a calibration test backdating a due date to before its own
   calibration date, violating the table's own `CHECK` constraint.

## Feature status

Legend: **Built+verified** · **Partial** (works, with named gaps) · **Not built**

| ID | Feature | Status | Notes / open gaps |
|---|---|---|---|
| F308 | Quality standards | Built+verified | Modelled as a quality plan's inspection points (characteristic, method, tolerance/allowed values, critical/destructive flags). |
| F309 | Inspection specifications | Built+verified | Same mechanism; a point's tolerance/allowed-values IS the specification the server checks results against. |
| F310 | Quality plans | Built+verified | Draft → approved by a second person → active; revision creates a new version keeping history; retiring needs a reason. |
| F311 | Quality control points | Built+verified | Inspection points, sequenced, each independently critical/destructive. |
| F312 | Incoming inspection | Built+verified | `plan_type='incoming'`; supplier-linked. |
| F313 | In-process inspection | Built+verified | `plan_type='in_process'`. |
| F314 | Final inspection | Built+verified | `plan_type='final'`. |
| F315 | Sampling plans | Built+verified | Full / fixed quantity / percentage / AQL, the last resolved automatically from a lot-size bracket table sharing one plan code. |
| F316 | Measurement checks | Built+verified | Numeric points checked against lower/upper limits server-side. |
| F317 | Pass/fail checks | Built+verified | Boolean/text points take an inspector-stated verdict (no server-derivable tolerance); selection points are checked against the point's allowed values. |
| F318 | Tolerances | Built+verified | Lower/target/upper limits per point, validated at plan-authoring time (lower ≤ upper) and enforced at result-recording time. |
| F319 | Inspection results | Built+verified | Per-sample-number results; a critical point's failure fails the whole lot; a non-critical failure is weighed against the AQL bracket's acceptance number when one applies. |
| F320 | Defect recording | Built+verified | A failed result IS the defect record; a non-conformance captures the fuller defect report (category, description, quantities, cost) separately. |
| F321 | Non-conformance (NCR) | Built+verified | Manual, or automatic from a failed inspection (via the F323 hold). Full state machine: open → under review → contained → a disposition set → closed. |
| F322 | Quality hold | Built+verified | Manual or automatic; scoped to an item/warehouse/batch/serial, or the whole item. |
| F323 | Quality hold must block stock movement | **Built+verified — proven with a real cross-module call** | Enforced inside Stock's own `postStockMovement` (pre-existing code, not written this pass), race-safe under a row lock taken before the balance check. This test suite's most important assertion calls the real function, not a mock. |
| F324 | Hold release | Built+verified | Full or partial, idempotent, optimistically versioned against a concurrent release. |
| F325 | Disposition | Built+verified | accept / accept-with-deviation / rework / repair / return-to-supplier / scrap / use-as-is. |
| F326 | Rework | Built+verified | A disposition value; the physical rework operation itself is Manufacturing's (rework orders already exist there) — Quality records the *decision*, not the shop-floor execution. |
| F327 | Scrap | Built+verified | Same: a disposition value recording the decision. |
| F328 | Return to supplier | Built+verified | Same: a disposition value; the actual return transaction is Procurement's. |
| F329 | Use-as-is approval | Built+verified | The one disposition requiring a second person's unconditional sign-off (see defect #3 above) before the non-conformance can close. |
| F330 | Root cause analysis | Built+verified | Recorded on the CAPA (method + finding), required before corrective/preventive actions can be recorded. |
| F331 | CAPA | Built+verified | Full lifecycle: open → analysis → implementation → verification → effective/ineffective → closed. A major/critical non-conformance cannot close without a verified-effective CAPA. |
| F332 | Corrective actions | Built+verified | A field on the CAPA, required before submission for verification. |
| F333 | Preventive actions | Built+verified | Same record, optional but capturable alongside the corrective action. |
| F334 | Supplier quality | Built+verified | A scorecard per supplier per period, **computed** from real inspection/non-conformance records (never entered by hand), re-runnable idempotently for the same period. |
| F335 | Customer quality complaints | Built+verified | Open → investigating (optionally linked to a non-conformance) → resolved → closed. A `support_ticket_id` column exists for cross-linking to a real Support ticket; nothing currently writes it automatically (see gaps). |
| F336 | Calibration | Built+verified | Due-date tracked; recording a new calibration for the same equipment (by asset link or a free-text identifier) automatically supersedes the prior valid record; an idempotent sweep expires anything past due. |
| F337 | Quality audits | Built+verified | Planned → in progress (findings added) → completed; a major finding blocks completion unless forced with a reason; a finding can link to a real CAPA. |
| F338 | Certificate of analysis | Built+verified | Draft → issued → (optionally) void with a reason. |
| F339 | Lot/batch traceability | Built+verified | A read-through timeline of every quality record (inspections, holds, non-conformances, certificates) against a batch/serial id — Quality does not own the batch/serial record itself (Stock does). |
| F340 | Quality documents | Built+verified | Procedures/work instructions/forms/specs: draft → review → approved by a second person → (later) obsolete, with revision keeping history — the same shape as Support's knowledge base. |
| F341 | Quality cost reporting | Built+verified | Estimated cost by severity and by disposition, from real non-conformance records. |
| F342 | Quality KPI dashboard | Built+verified | Open inspections, first-pass yield, active holds, open/critical non-conformances, open/overdue CAPA, overdue calibrations, open complaints — one live view. |

## Known limits of this work

- **No real-browser (Playwright) end-to-end test was written this pass** — the domain is proven on real
  Postgres (25 subtests) and the web layer is proven by `tsc`/`eslint`/route-security gates and (per the
  established pattern) a live compile/response smoke test of the routes, but no automated journey clicks
  through the actual UI yet.
- **F326-F328 (rework/scrap/return-to-supplier) record the *decision* only.** The physical execution —
  a Manufacturing rework order, a scrap stock adjustment, a Procurement return transaction — is each of
  those modules' own responsibility and is not triggered automatically from a Quality disposition. This
  mirrors how Support's tickets don't themselves perform the Sales/Procurement action they might imply.
- **F335's `support_ticket_id` link is a column, not an automated handoff**: nothing currently creates a
  Support ticket from a complaint, or a complaint from a Support ticket, automatically.
- **Audit findings have no dedicated detail screen** — they are managed through row actions on the parent
  audit and a flat findings list is not separately browsable in the web layer (the domain and its test
  coverage are complete; this is a web-layer scope cut, given the time available).
- **CAPA "corrective" and "preventive" actions are two fields on one record**, not independently tracked
  sub-entities with their own status/owner/due-date — a reasonable, common simplification, but a stricter
  QMS might want them as separate trackable items.
- Accessibility and visual-regression gates were not run beyond the static/typecheck gates described
  above. Registers fetch up to 500–2000 rows per view, matching every other module's convention.
