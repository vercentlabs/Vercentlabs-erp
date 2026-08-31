# Mobile and Offline Standard

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

Every feature receives one mobile classification: `FULL`, `FIELD_OPTIMIZED`, `APPROVAL_ONLY`, `READ_ONLY`, or `NOT_APPLICABLE`.

Offline is opt-in, never assumed. Approved offline workflows define: encrypted local entities, sync cursor/version, queued mutation schema, client-generated stable idempotency key, retry policy, server revalidation, conflict policy, attachment handling, revocation/session-expiry behavior and user-visible pending/conflict/error states.

Server truth remains authoritative. Offline code cannot bypass permissions, stock/financial/tax/payroll rules or legal state transitions. POS, scanning/receiving/picking, quality inspection, timesheets/attendance and selected field workflows receive specialized offline designs where their dossiers require it.
