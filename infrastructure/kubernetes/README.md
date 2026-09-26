# Kubernetes (GKE Autopilot)

Long-running workloads in namespace `vercentlabs`, deployed by
`.github/workflows/deploy.yml` (see `docs/operations/RELEASE_RUNBOOK.md`).

```text
base/                    namespace (PSA restricted, quota), service accounts (Workload Identity),
                         ConfigMaps (non-secret), SecretProviderClasses (Secret Manager files),
                         web, erp-worker, landing, HPA/PDB, NetworkPolicies, Ingress + managed cert
components/              optional integrations, enabled per overlay once their secret has a version
overlays/staging         minimum size
overlays/production      web 2-6 (connection budget), worker 2
jobs/migration           expand migrations + runtime role provisioning (one Job per release)
jobs/operations          ops:status, files:migrate-legacy, files:reconcile, secrets:reencrypt
jobs/operations-legacy   secrets:migrate-legacy (adds the legacy decrypt-only key)
deploy-values.example.json   every non-secret deploy value (CI renders with it)
```

Manifests contain `${NAME}` placeholders and are never applied unrendered:

```bash
node scripts/deploy/render-manifests.mjs --overlay production --values deploy-values.json --out app.yaml
node scripts/deploy/render-manifests.mjs --target migration --values deploy-values.json --out migration.yaml
OPERATION=status node scripts/deploy/render-manifests.mjs --target operations --values deploy-values.json --out ops.yaml
```

The renderer validates every value, keeps ConfigMap values as strings, and
refuses output with an unrendered placeholder, an image not pinned by
`@sha256` digest, a Kubernetes `Secret`, or secret material in a ConfigMap.

## Runtime model

- **Workloads**: `web` (Next.js ERP + API, port 3001), `erp-worker` (durable
  PostgreSQL jobs, health on 8081), `landing` (public site, port 3000).
- **Database**: each web/worker/Job pod runs the Cloud SQL Auth Proxy as a
  native sidecar (`initContainers` with `restartPolicy: Always`) and connects
  to `127.0.0.1:5432` with plain `pg`; the proxy uses the pod's Workload
  Identity and the instance's private IP. Three database authorities: web
  (`DATABASE_URL`), worker (`WORKER_DATABASE_URL`), migration
  (`MIGRATION_DATABASE_URL`, Jobs only). Web and worker never migrate.
- **Secrets**: Secret Manager → files through the GKE Secret Manager add-on;
  the application reads `NAME_FILE`. No Kubernetes `Secret`, no JSON keys.
- **Probes**: web — startup/liveness `/api/health`, readiness `/api/readiness`
  (configuration, database role, migrations, object storage); worker —
  `/livez`, `/readyz`. Web `preStop` sleeps 10 s so the load balancer stops
  routing before SIGTERM; the worker's 60 s grace exceeds
  `WORKER_SHUTDOWN_DEADLINE_MS` (45 s).
- **Security**: non-root UID 10001, read-only root filesystem, all
  capabilities dropped, seccomp `RuntimeDefault`, no service-account token,
  Pod Security Admission `restricted`, default-deny NetworkPolicies (see the
  egress rationale in `base/network-policy.yaml`).
- **Scaling**: web HPA on CPU bounded by the Cloud SQL connection budget
  (`infrastructure/terraform/README.md#connection-budget`); worker scales by
  replica count (lease-based claiming), PDBs for web, landing and worker.
- **Edge**: GKE Ingress → external HTTPS load balancer with a Google-managed
  certificate, HTTP→HTTPS redirect, TLS 1.2+ SSL policy and the Cloud Armor
  edge policy (`BackendConfig`).

## Rollback

Every Deployment keeps 10 revisions. Images are immutable digests, so a
rollback never rebuilds:

```bash
kubectl -n vercentlabs rollout undo deployment/web
kubectl -n vercentlabs rollout undo deployment/erp-worker
kubectl -n vercentlabs rollout status deployment/web
```

The previous digests of every release are recorded in its release manifest
(`rollbackTarget`). Database changes are forward-fix: expand migrations are
backward compatible with the previous release; contract migrations are never
rolled back automatically.
