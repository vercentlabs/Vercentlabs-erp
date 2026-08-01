# Stage 2A — CRM account, contact and relationship foundation

Stage 2A governs the existing shared `business_parties` and `contacts` masters as CRM Accounts and Contacts without duplicating customer data. It adds tenant-scoped duplicate discovery, auditable survivor-based merges, relationship graph retrieval, permission-protected HTTP commands and live PostgreSQL verification.

This stage does not implement the Lead Form Builder, layouts, record types, formula fields, bulk editing or UI redesign. Those belong to Stage 2B and later CRM waves.

## Completion evidence

- Forced-RLS merge-history tables exist.
- Account and contact duplicate queries are tenant scoped.
- Merge commands lock both records, reassign governed references, deactivate the source and retain immutable snapshots.
- Web commands require CRM account-management permission, billing write access, origin protection and audit evidence.
- Live verification executes inside a rolled-back PostgreSQL transaction.
