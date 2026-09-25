# Kubernetes deployment

The ERP uses long-running application deployments.

## Runtime workloads

- `web` — authenticated ERP web/API runtime
- `erp-worker` — durable PostgreSQL-backed background worker

The worker runs `services/worker/bin/start.mjs` and handles durable jobs,
scheduled ticks and outbound webhook delivery. It is not a set of one-shot
CronJobs.

## Security baseline

Runtime workloads should use:

- non-root containers
- read-only root filesystems where practical
- dropped Linux capabilities
- explicit CPU/memory requests and limits
- secrets/config injected through Kubernetes resources
- rolling deployments
- graceful termination

Database migrations are a deployment operation and are not executed by the
normal web request path.

## Architecture freeze (Shared Platform rebuild)

The target runtime topology is fixed; later prompts harden it, they do not
add new infrastructure classes:

```text
Web/BFF (Next.js route handlers + @vercentlabs/api domain services) ──► PostgreSQL (managed, 16+)
Worker  (services/worker: durable jobs, outbox, webhooks)            ──► PostgreSQL
Shared: object storage · secret manager · monitoring/logging
```

- No Redis, Kafka or external authorization service. Queues, outbox and
  idempotency are PostgreSQL tables; access snapshots are request-scoped.
- The web and worker connect as the restricted runtime role (NOBYPASSRLS,
  NOSUPERUSER); migrations run as a separate deployment operation with the
  migration role (`Dockerfile.migration`, `pnpm db:setup`).
- Preserved baseline in `base/`: non-root, seccomp `RuntimeDefault`, all
  capabilities dropped, read-only root filesystem, liveness/readiness probes,
  requests/limits, HPA, PodDisruptionBudget, default-deny network policies,
  and the separate worker deployment.
- Provider-specific resources (managed PostgreSQL, object storage, secret
  manager, DNS/certificates) stay environment-owned; see
  `infrastructure/terraform/README.md`.
