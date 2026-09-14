# F082 Rejected receipts — Atomic requirement trace

Dossier: record damaged/short/failed-inspection/rejected quantities with
quarantine/quality linkage, reason, disposition (return/rework/concession/
accepted), supplier-resolution evidence. Lifecycle: `DETECTED ->
QUARANTINED/REJECTED -> RETURN/REWORK/CONCESSION/ACCEPTED -> RESOLVED`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (rejected quantity capture) | PASS (minimal) | `rejectedQuantity` is a first-class, validated field on every receipt line (`normalizeDocument`'s `receipts` case, `index.js:547-549`); `evaluateReceiptHealth` (governance.js) flags `rejected > policy.receiptVarianceTolerance` as a warning and "Approved receipt still has rejected quantity" as a follow-up warning. |
| **CAP-002 — quarantine/quality linkage.** | **GAP, confirmed absent.** `grep`ed the module for `quarantine`/`quality_hold`/`disposition`: zero matches. A rejected quantity is just a number on the receipt line — there is no quality-hold record created, no linkage to the Quality module (`PROCUREMENT_RECEIPT_TO_QUALITY.md` describes this contract; not built, same finding as F080). |
| **CAP-002 — disposition workflow (return/rework/concession/accepted).** | **GAP, confirmed absent.** No disposition field or action exists distinguishing what happens to rejected stock next — the only related mechanism is the separate `returns` resource (F083), which requires manually creating a new document referencing the receipt; there's no guided "reject → choose disposition → system creates the right follow-on record" flow. |
| **CAP-002 — supplier-resolution evidence.** | **GAP.** No tracking of debit-note/credit/replacement resolution tied to a rejected quantity (consistent with F083's own finding that returns have no financial-correction linkage). |
| SEC-001, VAL-001 | PASS (generic, same as F080) | |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

Rejected quantity is captured and surfaced as a governance warning, which
is real value, but the feature as scoped (quarantine, disposition,
resolution tracking) does not exist beyond that single number. This is
closer to `FOUNDATION ONLY` than complete.
