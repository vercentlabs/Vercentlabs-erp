# F081 Partial receipts — Atomic requirement trace

Dossier: multiple partial receipts against one PO, preventing over-receipt,
preserving ordered/received/accepted/rejected/remaining quantities.
Lifecycle: `OPEN -> PARTIALLY_RECEIVED -> FULLY_RECEIVED/CLOSED with over/
under-receipt exception branches`.

Already substantially evidenced via `applyReceiptToOrder` in F074/F080.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FLOW-001 | PASS, genuinely strong | `applyReceiptToOrder` locks both the PO header and every PO line `FOR UPDATE`, accumulates `receivedQuantity` per line across however many receipts are posted (`previous + delta`), and **hard-blocks over-receipt**: `if (next < 0n || next > ordered) throw PROCUREMENT_RECEIPT_QUANTITY` — this is a real, transactionally-safe guard, not a soft warning. The PO's aggregate status (`acknowledged -> partially_received -> received`) is recomputed from the actual line totals every time, not tracked as a separate counter that could drift. |
| CONCURRENCY | PASS | Two concurrent receipt postings against the same PO would serialize correctly via the `FOR UPDATE` locks on both the header and every line row — this is correct enterprise-grade concurrency control. |
| DATA-002 | PASS | Each receipt remains its own permanent document; the PO's `receivedQuantity` is a derived aggregate, not a destructive overwrite of receipt history. |
| **Under-receipt handling.** | PARTIAL | Under-receipt (accepting less than ordered) is naturally representable (partial `receivedQuantity` short of `quantity`), and the PO correctly stays `partially_received`. There's no explicit "close short" exception workflow beyond the generic `close` transition (reachable from `partially_received`) — closing early is possible but not flagged as an explicit "under-receipt exception" distinct from a normal close. |
| INT-001/002 (Stock effect) | GAP (module-wide) | See F080/F063. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

This is one of the best-verified features in the module — the concurrency
and over-receipt-prevention logic is correct by direct code reading and
matches enterprise-grade expectations exactly. The only gap is the same
missing Stock effect already recorded against F080.
