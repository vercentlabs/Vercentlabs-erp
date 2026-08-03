# Enterprise release checklist

## Source and evidence

- [ ] Exact release commit is recorded and worktree is clean.
- [ ] Dependency audit, tests, lint, typechecks and builds pass.
- [ ] Stage 11 static and live governance checks pass.
- [ ] Four-module release claims match the module catalog.
- [ ] The 419 benchmark gate passes only if benchmark parity is claimed.

## Database

- [ ] Control-plane and tenant migrations complete without edited migration history.
- [ ] Restricted runtime role passes every database verifier.
- [ ] Verified custom-format backup, checksum and manifest are stored separately.
- [ ] Restore rehearsal succeeds on a disposable database.
- [ ] Restore logs and post-restore verifier output are attached as evidence.

## Security and reliability

- [ ] Production environment contracts pass for web, landing and migration.
- [ ] Web and landing security headers pass deployed smoke checks.
- [ ] Session, proxy, email, webhook, billing and rate-limit secrets are configured without appearing in logs.
- [ ] Workers have bounded retries, leases, dead-letter handling and accountable alerts.
- [ ] Critical/high incidents are resolved or formally block promotion.

## Operations

- [ ] Health and readiness endpoints pass before traffic.
- [ ] Readiness reports tenant migration `027_enterprise_release_governance.sql`.
- [ ] Monitoring covers availability, latency, errors, database health and queue lag.
- [ ] Alert recipients, incident commander and rollback decision-maker are named.
- [ ] Manual staging acceptance is complete for public and authenticated journeys.
- [ ] A production readiness snapshot is captured for the exact commit.

## Promotion decision

- [ ] Release score meets policy and readiness is `ready`.
- [ ] No unsupported modules or benchmark claims appear in customer-facing copy.
- [ ] Support, privacy, terms, commercial and data-retention owners approve go-live.
- [ ] Rollback image and database incident procedure are immediately available.
