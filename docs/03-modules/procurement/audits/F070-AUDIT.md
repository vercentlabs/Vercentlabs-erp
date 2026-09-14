# F070 RFQ to multiple vendors — Atomic requirement trace

Dossier lifecycle: `PREPARED -> SENT -> OPENED/RESPONDED/DECLINED/EXPIRED ->
CLOSED`.

`sourcing-invitations` is a real child resource of `sourcing-events`
(`RESOURCE_CONFIG["sourcing-invitations"]`, `CHILDREN["sourcing-events"]`),
editable while the parent event is `draft/submitted/approved/active`
(`CHILD_PARENT_EDITABLE_STATES`). UI: the generic `pass1-operations`
workspace exposes a real form action `create-sourcing-invitation` ("Invite
supplier to sourcing event") with a supplier picker (`options.suppliers`,
not free-text) and lists invitations as one of its readable resource tables.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS (functional, generic) | A real, permission-gated (`procurement.sourcing.manage`), version-checked child-create/update path exists with a working UI form (supplier selected from a real dropdown, not raw text). |
| **CAP-002 — per-invitation status lifecycle.** | **GAP, confirmed.** Like sourcing bids (F071), invitations are generic child resources created with a fixed `status: "active"` (`normalizeChild`, `index.js:573-587`) — there is no dedicated `sent/opened/responded/declined/expired` state machine. The dossier's rich per-invitation lifecycle is not implemented; an invitation is either present (active) or not. |
| **CAP-002 — confidentiality (invitee cannot see other invitees' bids).** | NOT INDEPENDENTLY VERIFIED. No supplier-portal-side read path was reviewed this pass (`portal-users` resource exists but wasn't traced); this needs verification before claiming bid confidentiality holds across the portal boundary specifically. |
| VAL-001, SEC-001 | PASS | Standard shared child-resource validation/scoping; parent-company match enforced (`validateChildParent`). |
| NOTIF-001 | GAP (module-wide) | No evidence any invitation actually notifies/emails the supplier — `outbox` writes a `procurement.sourcing-invitations.created`-shaped event indirectly via the generic `event`/`outbox` calls in `createProcurementRecord`'s child branch, but per F063 nothing ever consumes the outbox. A supplier invited to an RFQ receives no actual communication through any evidenced code path. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

An RFQ can genuinely be sent to multiple suppliers by creating multiple
invitation child records through a real UI form, with correct company/
parent-lifecycle validation. What's missing is everything downstream of
"the invitation exists": no per-invitation response tracking, and — most
materially — **no actual notification/email ever reaches the supplier**,
since the outbox mechanism the whole module relies on for this is dead
(see F063). Inviting a supplier today only creates a database row a buyer
can see internally; the supplier is never told.
