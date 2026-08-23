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
