# Stage 11 — Enterprise release, security and production readiness

## Purpose

Stage 11 adds a governed promotion layer above the four controlled early-access modules. It records executable check results, backup and restore evidence, deployment smoke evidence, open incidents and immutable readiness snapshots. It does not convert roadmap modules or unsupported benchmark capabilities into released functionality.

## Implemented scope

- Organisation-scoped release policies with fail-closed required checks.
- Immutable check runs with source, environment, commit and content hashes.
- Backup freshness and restore-rehearsal requirements.
- Critical/high incident thresholds and explicit incident ownership.
- Readiness scoring, blockers, warnings and immutable promotion snapshots.
- Release dashboard, API and timeline with organisation-management/audit permissions.
- Latest control-plane and tenant migration checks in `/api/readiness`.
- Release/runtime metadata in health and readiness responses.
- Checksum and manifest generation for PostgreSQL backups.
- Checksum-verified, single-transaction restore and disposable-target rehearsal.
- Landing and web security-header checks in deployment smoke verification.
- CI execution of Stage 11 static and live release-governance checks.
- Final release checklist and production runbook.

## Truthful benchmark boundary

The 419-capability register and evidence ledger remain independent gates. Stage 11 does not change a capability to `Implemented`, add acceptance evidence or mark the benchmark complete without executable proof. The exact gate remains:

```bash
pnpm verify:419-complete
```

At the Stage 10 baseline the register still contains partial, missing and hardening items and the evidence ledger is not fully verified. Therefore a successful Stage 11 installation means the release-governance machinery is complete; it does not by itself certify complete benchmark parity or a live production deployment.

## Production promotion

The local release gate verifies source, tests, builds and static contracts. Production promotion additionally requires:

1. Production environment contract validation for web, landing and migration jobs.
2. A verified backup and a restore rehearsal on a disposable database.
3. Deployed landing/web smoke checks including security headers and Stage 11 readiness metadata.
4. Monitoring, alerting, incident ownership and rollback decision-makers.
5. The 419 evidence gate only when benchmark parity is actually claimed.

## Migration

`027_enterprise_release_governance.sql` creates four forced-RLS tenant tables:

- `release_governance_policies`
- `release_governance_check_runs`
- `release_governance_incident_cases`
- `release_governance_snapshots`

All rows are isolated by `app.current_organization_id`.
