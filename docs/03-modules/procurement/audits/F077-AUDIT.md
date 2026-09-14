# F077 Blanket purchase orders — Atomic requirement trace

Dossier: bounded long-term ordering commitments with validity, quantity/
value ceilings, release consumption, remaining commitment, controlled
closure. Lifecycle: `DRAFT -> ACTIVE -> PARTIALLY_CONSUMED -> EXHAUSTED/
EXPIRED/CLOSED/CANCELLED`.

**No blanket-PO concept exists anywhere in the code.** Grepped the whole
module for `blanket`, `release order`, `releaseOrder`, `committedQuantity`,
`committedValue`, `remainingCommitment`: zero matches. `agreements`
(`RESOURCE_CONFIG.agreements`) is the closest existing resource — it has
`validFrom`/`validUntil` and lines with quantity/price, and a PO can
reference an agreement via `agreementId` (`DOCUMENT_REFERENCE_COLUMNS
["purchase-orders"].agreementId`) — but nothing tracks or enforces
consumption against the agreement's committed quantity/value once a PO is
raised against it.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (blanket PO / consumption tracking exists) | **FAIL — not built.** No ceiling, no consumption counter, no `PARTIALLY_CONSUMED`/`EXHAUSTED` status anywhere. |
| DATA-001 | **FAIL** | No data model for committed quantity/value or remaining balance. |
| Everything else in the dossier (validation, security, UX, reporting, etc.) | **N/A — nothing to evaluate.** There is no feature-specific code to trace beyond what `agreements` already provides generically (see F078). |

## Net assessment (2026-09-14)

This feature is **not implemented at all**, beyond the ability to reference
a parent agreement from a PO with no enforcement of any kind. This is a
genuine, scoped gap for the backlog — implementing it would mean adding a
committed-quantity/value ceiling to `agreements`, decrementing it
transactionally (with `FOR UPDATE` locking, matching the module's existing
concurrency discipline) each time a PO consumes against it, and a real
`PARTIALLY_CONSUMED`/`EXHAUSTED` status. Not attempted this pass —
recorded for the consolidated gap-closing pass or a future one, since it
is net-new scope rather than a fix to existing broken behavior.
