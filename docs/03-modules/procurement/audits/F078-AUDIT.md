# F078 Purchase agreements and contracts — Atomic requirement trace

Dossier: effective dates, suppliers, commercial conditions, committed
quantity/value, schedules, renewals/termination, release-order lineage.
Lifecycle: `DRAFT -> REVIEW -> ACTIVE -> SUSPENDED/EXPIRED/TERMINATED/
RENEWED`.

`agreements` is a real top-level document resource. `normalizeDocument`'s
case (`index.js:521-528`) requires `supplierId`, `validFrom`/`validUntil`,
at least one line. `TRANSITIONS.agreements` (`index.js:1300-1305`):
`submit/approve/activate/close/cancel`. Real list/detail/create UI
(`apps/web/src/app/(app)/procurement/contracts/`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS | Complete create/submit/approve/activate/close/cancel workflow, permission-gated (`procurement.contracts.manage`/`.approve`), real UI. Can be created directly or via `awardSourcingEvent`'s `agreement`-type award (F073), with lineage back to the source RFQ/bid preserved. |
| **CAP-002 — committed quantity/value ceiling and consumption.** | **GAP, confirmed absent — see F077.** No enforcement of a spend/quantity ceiling exists once an agreement is active. |
| **CAP-002 — renewal.** | **GAP.** Code's lifecycle is `draft/submitted/approved/active/closed/cancelled` — no `SUSPENDED`, `EXPIRED`, `TERMINATED` or `RENEWED` status exists; an agreement's `validUntil` date is stored but nothing automatically transitions an expired agreement out of `active`, and there's no renewal action that would create a follow-on agreement referencing the prior one. |
| VAL-001, DATA-001 | PASS | Standard shared-engine validation; `validFrom`/`validUntil` required. |
| SEC-001 | PASS | Standard scoping. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The agreement document itself works as a real contract record with a
correct create-to-active lifecycle and genuine lineage back to a sourcing
award when applicable. The dossier's specific "contract management" value —
committed-value tracking, expiry handling, renewal — is not built; an
agreement today is functionally a static commercial record with no
consumption or lifecycle automation beyond manual close/cancel.
