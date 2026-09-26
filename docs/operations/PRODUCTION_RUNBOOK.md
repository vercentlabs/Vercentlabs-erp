# Production runbook

Day-to-day operation of the ERP on Google Cloud (GKE Autopilot, Cloud SQL,
Cloud Storage, Secret Manager, Cloud KMS). Everything an operator needs
during an incident is here; no source reading required.

Audience: on-call engineers with `kubectl` access to the cluster and
`gcloud` access to the project. Related: `RELEASE_RUNBOOK.md` (deploy,
rollback, contract migrations), `DISASTER_RECOVERY_RUNBOOK.md` (outages,
restore).

```bash
gcloud container clusters get-credentials <cluster> --region asia-south1 --project <project>
alias k='kubectl -n vercentlabs'
```

`run_operation` (one-off operations Job with the migration authority) is
defined in `RELEASE_RUNBOOK.md` §2.

## 1. Health and readiness

| Endpoint | Meaning | Used by |
| --- | --- | --- |
| `GET /api/health` | web process alive (no dependencies) | liveness/startup probe |
| `GET /api/readiness` | configuration, restricted DB role, migrations current, object storage reachable; body lists failed checks only | readiness probe, load balancer health check |
| worker `:8081/livez` | worker process alive | liveness |
| worker `:8081/readyz` | polling started and a poll cycle completed recently | readiness |

```bash
k get pods -o wide
k describe pod <pod>                        # probe failures, restarts, events
curl -s https://<erp-host>/api/readiness    # {"status":"ok"|"unavailable","checks":{...}}
k logs deploy/web -c web --since=15m | grep '"event":"readiness.failed"'
k logs deploy/web -c cloud-sql-proxy --since=15m   # DB connectivity from the pod
```

Readiness failure causes → action:
- `configuration` → startup validation issue; `k logs <pod> -c web | head -50` lists every problem (missing secret file, wrong provider, etc.).
- `database` → Cloud SQL or the Auth Proxy sidecar; see DR runbook "Cloud SQL outage".
- `databaseRole` → the web is connecting with an unrestricted role: check the `database-url-web` secret version (must be the `vercent_web` role).
- `migrations` → the pod's build expects migrations that are not applied: the release's migration Job did not complete; re-run the release or roll back.
- `objectStorage` → bucket permission or GCS outage; see DR runbook "Storage outage".

## 2. Deploy, rollback, migrations

See `RELEASE_RUNBOOK.md`. Summary: **Deploy** workflow on `main` →
staging → approved production; rollback = `kubectl rollout undo` (no
rebuild); database = forward-fix; contract migrations only via
`run_operation contract-plan` / `contract-apply`.

## 3. Secrets and rotation

Secrets live in Secret Manager (`vercent-erp-<env>-<name>`), mounted into
pods as files (`NAME_FILE`) when a pod **starts**. Rotating a secret:

```bash
printf '%s' "$NEW_VALUE" | gcloud secrets versions add vercent-erp-production-<name> --data-file=-
k rollout restart deployment/web deployment/erp-worker   # pick up "latest"
k rollout status deployment/web
gcloud secrets versions disable <old-version> --secret=vercent-erp-production-<name>   # after verification
```

Special cases:
- **Database passwords** (`database-url-*`): change the role password and the
  secret together — add the new secret version, then run the next migration
  Job (it re-provisions `vercent_web`/`vercent_worker` with the password from
  the URLs) or `ALTER ROLE ... PASSWORD` as the migration role, then restart.
- **Razorpay webhook secret**: enable `components/razorpay-webhook-rotation`
  with the old value in `razorpay-webhook-secret-previous`, change the secret
  in Razorpay, deploy, then remove the component.
- **Integration secrets KEK (Cloud KMS)** rotates automatically every 90 days
  (new primary version; old versions still decrypt). Rewrap stored envelopes
  onto the new primary: `run_operation secrets-reencrypt --dry-run`, then
  `run_operation secrets-reencrypt`. Never destroy a KMS key version while
  `ops:status` shows envelopes on it.
- **Legacy key** (`INTEGRATION_TOKEN_ENCRYPTION_KEY`, decrypt-only):
  `run_operation secrets-migrate-legacy --dry-run`, then without `--dry-run`;
  when `ops:status` shows `legacySecrets: 0`, remove the
  `legacy-encryption-key` component and disable the secret.

## 4. Files (Cloud Storage)

```bash
run_operation files-migrate-legacy --dry-run   # attachments still holding bytes in PostgreSQL
run_operation files-migrate-legacy             # uploads, verifies size+SHA-256, then clears the DB bytes; resumable
run_operation files-reconcile                  # metadata vs bucket: missing objects, size/hash mismatches
```

`files.object.missing` / `files.storage.failed` events (alert
`storage-failure`) → run `files-reconcile`; restore a missing object from a
noncurrent version or soft delete (DR runbook "Storage").

## 5. Worker inspection, dead jobs, dead webhooks

```bash
k logs deploy/erp-worker -c worker --since=30m | grep -E '"event":"worker\.(job\.(dead|failed)|lease\.recovered)"'
k logs deploy/erp-worker -c worker --since=30m | grep '"event":"db.pool"'          # waiting > 0 = pool saturated
curl -s localhost:8081/readyz   # via: k port-forward deploy/erp-worker 8081:8081
```

- **Dead jobs** (alert `worker-job-dead`): the job exhausted its retries or
  had an invalid payload. Settings → Jobs shows it with its last error (the
  organisation's operators can see their own jobs); fix the cause, then the
  user re-runs the action. Do not edit `tenant.background_jobs` by hand.
- **Lease recoveries** (`worker.lease.recovered`): a worker died mid-job and
  another reclaimed it — expected after a node drain; many in a row means
  crashing workers (`k get pods`, `crash-loop` alert).
- **Webhooks** (alert `webhook-delivery-dead`): a customer endpoint rejects
  deliveries. Settings → Integrations → Webhooks → deliveries shows the
  failure; the customer fixes their endpoint and uses *Redeliver*. Operator
  kill switch: feature flag `operator.webhooks / delivery_paused` stops
  delivery for an organisation (queued deliveries are kept).
- **Worker capacity**: replicas × `WORKER_CONCURRENCY` lanes; each replica
  needs `DATABASE_POOL_MAX ≥ WORKER_CONCURRENCY + 3`. Scale replicas in the
  overlay within the connection budget (`infrastructure/terraform/README.md`).

## 6. Billing health

```bash
k logs deploy/web -c web --since=1h | grep '"event":"billing\.'
k logs deploy/erp-worker -c worker --since=1h | grep -E '"event":"billing\.(webhook\.dead_lettered|reconciliation\.mismatch|checkout\.(recovery_failed|intervention_required))"'
```

- `billing.webhook.dead_lettered` (CRITICAL): a verified Razorpay event could
  not be applied after retries. The worker's billing maintenance keeps
  reconciling from the provider; check Razorpay status, then the
  organisation's Billing page (status, last event). Never mark a subscription
  paid by hand.
- `billing.reconciliation.mismatch`: provider and local state differ; the
  reconciler corrects local state from the provider on its next tick.
- Provider outage: see DR runbook.

## 7. OAuth connected accounts

Symptom: "reconnect required" on Settings → Integrations → Connected
accounts, or token refresh failures in worker logs. Causes: the user revoked
access at Google/Microsoft, the client secret was rotated, or the KMS key
cannot decrypt (check `secrets-reencrypt --dry-run`). Action: the
organisation's integration admin reconnects; if every connection fails, check
the `google-oauth-client-secret` / `microsoft-oauth-client-secret` versions and
the redirect URI `https://<erp-host>/api/settings/integrations/oauth/callback/<provider>`.

## 8. Database restore

See `DISASTER_RECOVERY_RUNBOOK.md` §2. Rehearse monthly with the
**Restore rehearsal** workflow (clone → verify → delete).

## Alerts

| Alert | Severity | First response |
| --- | --- | --- |
| web-5xx (load balancer 5xx rate) | CRITICAL | §1; `k logs deploy/web -c web \| grep '"event":"http.\(server_error\|unhandled_error\)"'`; roll back if it started with a release |
| readiness-failed | CRITICAL | §1 readiness causes |
| crash-loop (container restarts) | CRITICAL | `k describe pod`; `k logs --previous`; roll back if release-related |
| worker-down | CRITICAL | §5; `k get deploy erp-worker`; DB connectivity |
| worker-job-dead | WARNING | §5 dead jobs |
| webhook-delivery-dead | WARNING | §5 webhooks |
| billing-webhook-dead | CRITICAL | §6 |
| billing-recovery-failed | WARNING | §6 |
| storage-failure | CRITICAL | §4 |
| db-pool-waiting | WARNING | pool saturated: check slow queries (Query Insights), then connection budget |
| Cloud SQL cpu / disk / connections | WARNING | Query Insights; disk auto-grows; connections → budget |
| Cloud SQL unavailable | CRITICAL | DR runbook §1 |

## Incident log pointers

- Logs: Cloud Logging, `resource.type="k8s_container" resource.labels.namespace_name="vercentlabs"`; filter `jsonPayload.requestId="<id>"` (every response carries `x-request-id`) or `jsonPayload.event="<name>"`.
- Errors: Error Reporting (grouped by stack; service `web`/`worker`/…, version = release SHA).
- Edge: load balancer logs and Cloud Armor (`enforcedSecurityPolicy`) in Cloud Logging.
- Database: Cloud SQL Query Insights; `log_min_duration_statement=1000ms` slow-query logs.
- Releases: GitHub Actions → Deploy runs → `release-<env>` artifacts (commit, digests, migrations, rollback target).
- Audit: Settings → Audit in the ERP (organisation-scoped evidence, including request ids).
