# F087 Landed costs — Atomic requirement trace

Dossier: allocate freight/duty/insurance/other landed costs deterministically
to eligible received inventory using governed allocation bases and stock/
accounting posting contracts. Lifecycle: `DRAFT -> ALLOCATED/PREVIEWED ->
VALIDATED/POSTED -> REVERSED through compensating valuation/accounting
entry`.

`createProcurementLandedCost` (`pass1-operations.js:53-65`) is the real
implementation. Real UI: `pass1-operations-workspace.tsx`'s
`create-landed-cost` action (PO/receipt picker, amount, currency,
allocation method, cost type, note).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (capture) | PASS | Requires a PO or receipt reference (at least one), cross-validates they belong to the same company if both given, validates amount ≥ 0, currency is a 3-letter code, `allocationMethod` is one of a real enum (`value/quantity/weight/manual`), `costType` required. Real, permission-gated (`procurement.matching.manage`) create path with a working form. |
| **CAP-001 — actual allocation math.** | **GAP, confirmed absent.** The function **records** a landed cost amount and a chosen allocation method as a flat row (`tenant.procurement_landed_costs`) — it does not actually **compute** a per-line/per-item allocated share. There is no code anywhere that distributes the recorded amount across the referenced PO/receipt's lines by value, quantity or weight; `allocationMethod` is stored but never consumed by any calculation. |
| **INT-001/002 — Stock/Accounting posting.** | **GAP, confirmed absent — consistent with F080's finding.** No call to Stock (to adjust item valuation) or Accounting (to post the landed cost as a real ledger entry) exists anywhere. The dossier explicitly requires "stock/accounting posting contracts"; none exist. |
| VAL-001 | PASS | Amount/currency/method/cost-type validation is real. |
| SEC-001 | PASS | Standard scoping via the linked PO/receipt's company. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

This is record-keeping only: a landed cost can be logged against a PO or
receipt with real validation, but nothing computes the actual per-line
allocation or posts any resulting valuation/accounting effect. This is
`FOUNDATION ONLY` relative to the dossier's actual scope.
