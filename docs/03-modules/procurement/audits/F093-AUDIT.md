# F093 Purchase history — Atomic requirement trace

Dossier: immutable searchable purchase history spanning requisition,
sourcing, PO, receipt, return, invoice/match and supplier context, without
rewriting historical facts. Lifecycle: `APPEND-ONLY PURCHASE EVENTS/
DOCUMENT VERSIONS with corrections represented by linked reversal/revision
facts`.

No single dedicated "purchase history" resource/page exists; this is
served (partially) by `getProcurementGovernanceTimeline`
(`governance.js:770-795`) plus each document's own list/detail views.

| ID | Verdict | Evidence |
|---|---|---|
| **CAP-001 — unified cross-entity history.** | **GAP, confirmed absent.** `getProcurementGovernanceTimeline` unions events/snapshots/exception-case changes **for one entity at a time** (`entityType`+`entityId` required) — there is no query or view that assembles the full requisition→sourcing→PO→receipt→return→invoice/match chain for, say, one supplier or one item across documents. A user would have to manually open each document type's own list and cross-reference by supplier/PO number. |
| DATA-002 (immutability, no history rewrite) | PASS | Every document type appends `event()` rows permanently; amendments/rejections are represented as new entries with `previousStatus`/`previousVersion`/`previousHash` (see F076) rather than overwriting; matching records are a permanent ledger (F085/F086). The underlying facts genuinely are append-only where they matter. |
| REP-001 | PASS (partial) | `cycle-time` report (`REPORT_SQL`) does compute a real cross-entity-type duration metric from `procurement_events`, which is one useful cross-cutting view, but not a full document-chain history. |
| SEC-001 | PASS | Timeline/event queries are organization+company scoped like everything else. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The underlying data is genuinely immutable and append-only — the module
never rewrites history. What's missing is a single feature that actually
presents that history as a connected chain across document types; today
it's scattered per-entity timelines and per-document-type lists.
