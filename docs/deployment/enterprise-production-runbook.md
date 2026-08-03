# Enterprise production promotion runbook

## Release boundary

The deployable controlled early-access scope is CRM, Sales, Accounting and Procurement, plus the shared platform, landing site and native CRM-oriented mobile client. Eight catalogued modules remain roadmap scope. Do not broaden public claims beyond the module catalog and executable evidence.

## Roles and credentials

Use separate credentials and execution environments:

- Migration job: owner-level `MIGRATION_DATABASE_URL`, runtime role name and generated password. It exits after migrations and provisioning.
- Web/workers: restricted `DATABASE_URL` only, with `ENFORCE_RESTRICTED_DB_ROLE=true`.
- Landing: no database credentials; signed CRM capture or signed webhook delivery only.
- Backup job: dedicated `BACKUP_DATABASE_URL` with the minimum privileges needed by `pg_dump`.
- Restore rehearsal: a disposable `RESTORE_REHEARSAL_DATABASE_URL`; never point rehearsal automation at production.

## Pre-promotion gates

Run from the exact immutable release commit:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm release:gate
corepack pnpm verify:stage-11
corepack pnpm report:release-readiness
```

Run the benchmark gate only when complete benchmark parity is being claimed:

```bash
corepack pnpm release:benchmark-gate
```

A failing benchmark gate must not be bypassed by editing the evidence ledger.

## Database and restore evidence

Create a verified backup:

```bash
BACKUP_DATABASE_URL='postgresql://...' \
  bash scripts/database/backup-postgres.sh
```

Preserve the `.dump`, `.sha256` and `.manifest.json` files in separate encrypted storage.

Rehearse restore on a disposable database:

```bash
BACKUP_DATABASE_URL='postgresql://source...' \
RESTORE_REHEARSAL_DATABASE_URL='postgresql://disposable...' \
CONFIRM_RESTORE_REHEARSAL=REHEARSE_ON_DISPOSABLE_DATABASE \
  bash scripts/database/rehearse-restore.sh
```

Store the command output and verifier results as a `restore` release check. A successful backup without a restore rehearsal is not disaster-recovery evidence.

## Deployment sequence

1. Freeze the release commit and record its SHA.
2. Validate production environment contracts for migration, web and landing.
3. Create and externally copy the verified backup.
4. Apply control-plane and tenant migrations from the isolated migration job.
5. Provision the restricted runtime role and remove migration credentials.
6. Run control, tenant, CRM, Sales, Accounting, Procurement and Billing database verifiers.
7. Deploy immutable web, landing and worker images without public traffic.
8. Verify `/api/health` and `/api/readiness`; readiness must report `027_enterprise_release_governance.sql`.
9. Run the deployed smoke check with `LANDING_URL` and `WEB_URL`.
10. Record each check through the release-governance API or the controlled administrative process.
11. Capture a staging/production readiness snapshot.
12. Promote traffic only when the snapshot is `ready`, no critical/high incident exceeds policy and accountable monitoring is active.

## Rollback and incidents

Application rollback routes traffic to the previous immutable image. Database rollback is normally a new forward migration. Restore is an incident action requiring stopped writers, a reviewed data-loss window and the explicit restore confirmation token.

Open a release incident for failed migrations, data-integrity findings, authentication failures, queue backlog, elevated error rates, unavailable dependencies, privacy incidents or smoke-test failures. Critical and high incidents block promotion by default.

## External operational requirements

The repository cannot itself prove that production alerting reaches a human, backups are stored off-site, DNS/TLS are correct, provider credentials work, privacy/legal approvals exist or support is staffed. These remain explicit go-live evidence, not assumptions.
