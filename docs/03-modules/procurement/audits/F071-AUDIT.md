# F071 Supplier quotations — Atomic requirement trace

Dossier lifecycle: `DRAFT -> SUBMITTED -> REVISED/WITHDRAWN -> ACCEPTED/
REJECTED/EXPIRED`.

`sourcing-bids` is a generic child resource of `sourcing-events`, editable
only while the parent event is `active` (`CHILD_PARENT_EDITABLE_STATES
["sourcing-bids"] = ["active"]`). UI: `pass1-operations-workspace.tsx`'s
`record-supplier-bid` action — a real form (sourcing event + supplier
pickers, quotation number, total amount, currency, delivery days, note).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS (functional, generic) | A bid can genuinely be recorded against a real sourcing event/supplier through a working form; company/parent-lifecycle validated via the shared child-resource path. |
| **CAP-002 — bid status lifecycle.** | **GAP, confirmed.** Bids are created with a fixed `status: "active"` (`normalizeChild`) and have **no dedicated transition table** (`TRANSITIONS` has no `sourcing-bids` entry) — there is no `submitted -> revised -> withdrawn -> accepted/rejected/expired` state machine at all. A bid is simply "active" (present) until the parent sourcing event is awarded, at which point `awardSourcingEvent` reads `source.bids` to find the selected one but never marks losing bids as `rejected` or the winning one as `accepted` — no bid ever changes status. |
| **CAP-002 — revision history.** | **GAP.** No versioning of a bid's price/terms over time was found; updating a bid via the generic child-update path just overwrites the JSON `data`, with the standard optimistic-concurrency version bump but no separate "revision" concept the dossier describes (a supplier revising their price should arguably create a new tracked revision, not silently overwrite the prior one). |
| **CAP-002 — validity/expiry.** | **GAP.** No `validUntil`/expiry field or automatic expiry transition exists for bids (contrast with F038 in Sales, which has real quotation-expiry scanning — Procurement has nothing equivalent for supplier bids). |
| DATA-001, VAL-001 | PASS (thin) | Standard child-resource validation. |
| SEC-001 | PASS | Standard scoping. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

A supplier's quotation can be recorded and later referenced at award time —
the minimum needed for the Supplier→...→Payment journey to function. But
the feature as the dossier actually describes it (a real bid lifecycle with
revision, withdrawal, expiry, and explicit accept/reject outcomes) is not
built; bids are just static records read once at award time.
