# Authoritative Write Operation Constitution

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

Every business mutation follows this ordered control plane:

`authenticate -> organization -> entitlement -> permission -> company -> branch/site/warehouse/project/team scope -> record scope -> request validation -> load authoritative state -> business invariants/state transition -> BEGIN transaction -> establish tenant/RLS context on the same checked-out client -> acquire required lock/version guard -> deterministic calculations -> domain writes -> audit -> outbox/event -> COMMIT -> response`.

On failure: `ROLLBACK -> no partial business truth -> actionable typed error -> safe retry semantics`.

## Mandatory rules
1. Normal requests and product workers never mutate another module's private tables.
2. Tenant context is transaction/client scoped; never assume `SET LOCAL`/`set_config(..., true)` survives outside the transaction or moves across pooled connections.
3. Authorization is server authoritative even when UI hides actions. RLS is defense-in-depth, not the only permission layer.
4. Retried commands carry a stable idempotency/business key where duplicate effects would be harmful.
5. Concurrency-sensitive invariants use row/advisory locks, unique constraints, compare-and-swap/version checks, or another documented DB-safe mechanism.
6. Posted/consumed/financial truth is corrected by reversal/compensation, not silent deletion.
7. Audit and outbox records are written in the same transaction as the authoritative state they describe when required for consistency.
8. Async failure becomes visible/pending/exception state with bounded retry and reconciliation; it never disappears silently.
