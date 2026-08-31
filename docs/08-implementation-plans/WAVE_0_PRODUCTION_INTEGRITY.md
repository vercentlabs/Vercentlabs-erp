# Wave 0 — Production Integrity Foundation

Status: IMPLEMENTED_IN_WORKING_TREE_PENDING_FULL_ENVIRONMENT_CERTIFICATION

Evidence commit SHA: PENDING_COMMIT_SHA

Wave 0 hardens shared ERP invariants before any F001–F510 feature is advanced to COMPLETE. It does not itself certify any canonical feature as production complete.

## Implemented workstreams

- Repository/documentation baseline repair for current executable tests and local documentation links.
- Transaction-safe company-scoped business document numbering via `tenant.document_sequences`.
- Canonical semantic idempotency with stable request hashing and deterministic conflicting-key rejection via `tenant.operation_idempotency`.
- Reusable same-tenant company/reference integrity guards.
- HR & Payroll sensitive/payslip read authorization hardening.
- Quality Hold -> Stock hard transactional gating with shared inventory locking and auditable partial/full release.
- POS sale idempotency, fail-closed external payment handling, authoritative return validation, approval separation, refund/restock completion, and returned-quantity invariants.
- Manufacturing parent-operation idempotency so replay-safe Stock movements cannot be followed by duplicate Manufacturing quantity/posting side effects.
- Transaction-safe numbering replacement across audited server-side business-number generators in Wave 0 scope.
- Documentation link validator added to `verify:architecture`.

## Migration

- `database/tenant/migrations/072_wave0_production_integrity.sql`

The migration adds shared numbering/idempotency ledgers, Quality hold release/version data, a Quality release ledger, POS returned-quantity protection, indexes, and forced tenant RLS for new tenant tables.

## Focused verification executed during patch construction

The patch was syntax-checked with `node --check` for changed JavaScript modules and the documentation link validator.

Focused runtime regression suites executed successfully in the audited snapshot:

- CRM/Pass-1 web subset: 67/67 passing.
- Stock/POS/Manufacturing/Pass-1 API integrity subset: 29/29 passing.
- Wave 0 core behavioral tests: see `services/api/tests/wave0-production-integrity.test.mjs`.

Full `pnpm verify` / `release:verify` must be executed in the target repository with Node 24, pnpm 11.21.0, dependencies installed, and required local services available. Do not replace missing environment verification with a false PASS.

## Completion rule

Wave 0 is certified only after the target repository passes its applicable verification/release gates. F001–F510 remain governed by their own feature-level Definition of Done and UAT evidence requirements.
