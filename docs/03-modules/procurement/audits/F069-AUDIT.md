# F069 RFQ creation — Atomic requirement trace

Dossier lifecycle: `DRAFT -> READY -> ISSUED -> AMENDED/CLOSED/CANCELLED`.

`sourcing-events` is the real resource (`eventType` defaults to `"rfq"`,
`normalizeDocument`'s `"sourcing-events"` case requires `title`/`bidCloseAt`,
`index.js:513-520`). `TRANSITIONS["sourcing-events"]`: `submit/approve/
activate/close/cancel` (`index.js:1293-1298`). Real list/detail/create
pages (`apps/web/src/app/(app)/procurement/sourcing/`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS | Real create/submit/approve/activate/close/cancel workflow, permission-gated (`procurement.sourcing.manage`/`.evaluate`), real UI. |
| FLOW-001 (lifecycle terminology) | PARTIAL | Code's `draft -> submitted -> approved -> active -> closed/cancelled` maps reasonably to the dossier's `DRAFT -> READY -> ISSUED` (submitted≈ready, approved+active≈issued) but there is **no `AMENDED` state or amendment mechanism** — unlike purchase orders (which have a full `amendPurchaseOrder`/approve-amendment/reject-amendment flow, F076), a sourcing event/RFQ cannot be revised once `submitted` (the generic edit-lock only allows edits while `draft`/`rejected`, and `sourcing-events` has no `rejected` status in its transition table at all, so once submitted the RFQ header is permanently locked short of cancelling it outright). |
| DATA-001 (event type differentiation) | PARTIAL | `eventType` field exists (`"rfq"` default) but nothing in the code differentiates behavior by RFI/RFQ/RFP/auction type beyond storing the string — no type-specific validation or workflow branching was found. |
| VAL-001, BR-001 | PASS | Standard shared-engine validation (`bidCloseAt` required). |
| SEC-001/002 | PASS | Standard scoping. |
| CONCURRENCY | PASS | Optimistic version check on every transition. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The RFQ document/lifecycle itself is real and functional through create →
submit → approve → activate → close/cancel, with a working UI. The one
concrete gap is the missing amendment path — once an RFQ is out the door,
it cannot be formally revised (only cancelled and presumably recreated),
unlike the PO amendment machinery this same module already built for a
different resource. Scoped, low-risk to add by reusing the PO amendment
pattern if prioritized in the gap-closing pass.
