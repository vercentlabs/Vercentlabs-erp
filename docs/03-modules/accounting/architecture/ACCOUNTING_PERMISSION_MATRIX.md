# Accounting Permission / SoD Matrix

Separate prepare, approve, post, reverse, period-close/reopen, bank-reconcile, tax-config, consolidation and audit roles. Self-approval is blocked where configured; cross-company access is explicit. Bank/tax-sensitive fields are least-privilege and masked. Server-side/RLS/IDOR negatives are mandatory.
