# Deployment and Environment Plan

Required environments: `local`, `CI`, `development`, `staging`, `production`.

A production release sequences compatible database migrations, worker/web deployment, health/smoke checks, feature flags/progressive enablement, observability checks and reconciliation. Database changes must remain compatible across rolling/partial deployment where applicable. Secrets are environment/provider managed, never committed. Staging exercises production-like auth, tenant isolation, workers, integrations and restore/migration flows using non-production data.
