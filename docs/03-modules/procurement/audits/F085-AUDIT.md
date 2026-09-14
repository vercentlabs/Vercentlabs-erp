# F085 2-way matching — Atomic requirement trace

Dossier: deterministic two-way match (invoice vs PO) with quantity/price/
tax/charge tolerances, exceptions, override authority, audit. Lifecycle:
`UNMATCHED -> MATCHED or EXCEPTION -> RESOLVED/OVERRIDDEN/REJECTED`.

`runProcurementMatch` with `matchMode: "two-way"` is the implementation
(shared with F086; already read in full during reconnaissance).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CALC-001 | PASS, genuinely well-built | Per-line variance computed in exact integer/decimal arithmetic (`decimal`/`format` from `money.js`, not floating point): `allowed = |orderAmount| * tolerancePercent / 100`, issue raised if `|invoiceAmount - orderAmount| > allowed`. Two-way mode caps cumulative invoiced quantity against the **ordered** quantity (`maximumQuantity = orderedQuantity` when `matchMode === "two-way"`), correctly distinguishing it from three-way's receipt-based cap. |
| VAL-001 (tolerance policy) | PASS | Tolerance comes from a real, configurable per-company policy row (`procurement_policies` with `policyType='matching_tolerance'`) rather than a hardcoded constant; a caller can override it but only with `procurement.matching.override` permission **and** a mandatory reason (`toleranceOverrideReason`), both enforced server-side. |
| **CAP-002 — tax/charge-line tolerance.** | PARTIAL | The variance calculation compares each line's total amount (`lineAmount = quantity*unitPrice + taxAmount`) as one combined figure — tax is folded into the same tolerance check as price, not evaluated as its own separate tolerance dimension the way the dossier implies ("quantity/price/tax/charge tolerances" as plural, distinct checks). Not necessarily wrong, but narrower than the dossier's framing. |
| FLOW-001 (exception creation) | PASS | Any issue routes to a real `match-exceptions` document (`createProcurementRecord`, idempotency-keyed to the match ledger row so a retried match can't double-create the exception) rather than silently blocking or silently passing. |
| CONCURRENCY/IDEMPOTENCY | PASS | `FOR UPDATE` on the PO and its lines, duplicate-invoice-number guard, idempotent exception creation. |
| **INT-001/002 — Accounting handoff.** | GAP (module-wide) | See F084 — clean matches never reach Accounting since the outbox is dead. |
| SEC-001 | PASS | |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The matching *calculation* itself is correct, deterministic, and properly
gated — this is real, careful financial-control engineering. The gap is
entirely at the boundary (the Accounting handoff, shared with F086/F084),
not in the matching logic.
