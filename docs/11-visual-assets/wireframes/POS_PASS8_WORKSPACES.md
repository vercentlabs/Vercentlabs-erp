# POS Pass 8 Low-Fidelity Workspaces

## Terminal checkout
`[store/terminal/shift/offline] [search/scan] | CART lines price discount tax | totals | customer | HOLD | PAY`
Tender drawer shows cash/card/UPI/split components with explicit pending/success/failure/reconcile states.

## Returns
Original receipt search → eligible lines/remaining quantities → reason/disposition → approval → refund method/status → Stock/accounting outcomes.

## Shift / cash
Opening float → cash movements → expected vs counted → variance → supervisor resolution → close → Z → payment reconciliation.

## Offline/conflict
Persistent offline banner, locally queued transaction IDs, sync state and conflict-resolution cards. Never show ambiguous “failed” when provider/sync outcome is unknown.

All critical flows support keyboard + touch, accessible scan fallback and announced errors/status.
