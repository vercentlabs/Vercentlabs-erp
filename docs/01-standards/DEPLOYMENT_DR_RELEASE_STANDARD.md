# Deployment, DR and Release Standard

Status: `ARCHITECTURE_FROZEN_PASS_E`

Environments are local, CI, development, staging and production. Database migrations are forward-safe and compatible with staged/rolling application and worker deployment. Release sequencing includes migration compatibility, application/worker deploy, health/smoke checks, feature-flag/progressive enablement, observability, reconciliation and rollback decision points.

Production readiness requires automated backups/PITR as appropriate, encrypted retention, documented RPO/RTO, restore rehearsal, disaster runbook, migration rehearsal and rollback rehearsal. A backup job succeeding is not restore evidence. Staging must exercise production-like tenant isolation, authorization, workers, integrations, migration and restore behavior with non-production data.

Secrets are provider/environment managed; production credentials never live in the repository or client-visible bundles.
