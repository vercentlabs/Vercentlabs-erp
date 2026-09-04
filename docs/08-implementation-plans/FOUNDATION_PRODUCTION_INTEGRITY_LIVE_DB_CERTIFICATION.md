# Foundation Production Integrity — Live Database Certification

Status: **PASS**

Certified at: `2026-09-03T19:32:39+05:30`

## Certified baseline

- Node: `v24.19.0`
- pnpm: `11.21.0`
- PostgreSQL: `16.15`
- Database: disposable local `vercentlabs_wave0_cert`
- Migration: `database/tenant/migrations/072_wave0_production_integrity.sql`
- Migration SHA-256: `467d1336039fbc38fbb0b3174628c55d4b9a30b08da93c90911f48667145a4e7`

## Live PostgreSQL evidence

The certification ran against a freshly created local PostgreSQL database after applying every platform and tenant migration.

The following production-integrity foundation invariants passed:

1. Certification seed/schema contract covers every mandatory no-default column in all seeded application tables.
2. Migration 072 is applied exactly once with a recorded checksum.
3. `tenant.document_sequences`, `tenant.operation_idempotency`, and `tenant.quality_hold_releases` have enabled and forced RLS.
4. The runtime role is NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, and NOCREATEROLE and cannot read `public.schema_migrations`.
5. Cross-organization access to foundation rows is hidden/rejected by RLS.
6. 100 concurrent company-scoped business-number allocations produce 100 unique deterministic numbers.
7. A 20-way same-key idempotency race performs one mutation and replays the other 19; reusing the key with a different payload is rejected.
8. A same-organization UUID belonging to another company is rejected by company-reference validation.
9. Broad HR view permission cannot read sensitive payslips.
10. An active Quality hold blocks a Stock issue; a concurrent Stock issue waits on the shared advisory transaction lock and proceeds only after the Quality release commits.
11. Concurrent POS returned-quantity updates cannot persist a returned quantity above the sold quantity.
12. Repeating a Manufacturing production post with the same idempotency key creates exactly one production posting and one finished-goods Stock movement; a changed payload conflicts.
13. The shared inventory advisory lock serializes same-org/company/item contenders.

## Release evidence

The repository release gate was separately run on the same production-integrity foundation working tree before this live certification and reached:

- landing E2E: 544 / 544 passed
- `Full release verification passed`
- `WAVE 0 RELEASE GATES ARE GREEN`

## Scope note

This certification covers the production-integrity foundation. It does **not** mark F001-F510 complete. Feature completion remains governed by the canonical end-to-end completion standard.
