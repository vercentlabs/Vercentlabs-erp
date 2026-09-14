# F086 3-way matching (PO/GRN/invoice) — Atomic requirement trace

Dossier: execute/explain a three-way match, resolve/approve exceptions
under tolerance policy, payment eligibility follows the authoritative
result. Same `runProcurementMatch` implementation as F085, `matchMode:
"three-way"` (default) or `"four-way"`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | Three-way mode caps cumulative invoiced quantity against **received** quantity, not ordered (`maximumQuantity = matchMode === "two-way" ? orderedQuantity : receivedQuantity`) — correctly implements the actual three-way distinction (can't invoice for more than was physically received, not just ordered). Issue type is labeled distinctly (`receipt-quantity-variance` vs two-way's `order-quantity-variance`), so the result is genuinely explainable, not a generic error. |
| **Four-way mode.** | PASS (real, if minimal) | `matchMode === "four-way"` additionally requires `orderLine.inspectionAccepted` to be truthy, raising an `inspection-not-accepted` issue otherwise — a real fourth check exists, though `inspectionAccepted` is read from the PO line's `data` with **no evidenced write path** (no code sets this flag anywhere in Procurement, and there's no Quality-module integration per F080/F082's findings) — so four-way mode would currently always flag every line as `inspection-not-accepted` unless something outside this codebase's traced scope sets that field. |
| **"Payment eligibility follows the authoritative result."** | **GAP, confirmed cannot follow through — see F084.** Even a fully clean three-way match only reaches an outbox event nothing consumes; there is no Accounting-side payment-eligibility flag that a clean match actually sets. |
| Everything else (tolerance policy, exception creation, concurrency, security) | PASS | Identical evidence to F085 — same function, same guarantees. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

Three-way matching is correctly distinguished from two-way at the exact
point that matters (received vs. ordered quantity as the invoicing
ceiling) — this is the right implementation, not a shortcut. Four-way
exists as real branching logic but is effectively unreachable as
"passing" today since nothing ever sets `inspectionAccepted`. The
Accounting-handoff gap (F084) is what actually blocks "payment eligibility"
from meaning anything yet.
