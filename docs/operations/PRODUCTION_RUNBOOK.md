# Production runbook

For whoever is on call for Vercentlabs ERP. Every alert in `infrastructure/terraform/monitoring.tf` links here
(`#alerts`, with the alert's key in brackets). A whole-database outage or restore is in
[DISASTER_RECOVERY_RUNBOOK.md](DISASTER_RECOVERY_RUNBOOK.md).

## The system in one paragraph

GKE runs three workloads in the `vercentlabs` namespace: `vercentlabs-web` (Next.js, all HTTP), `erp-worker` (background jobs,
schedules, outbound webhooks, billing maintenance) and `vercentlabs-landing`. Each pod reaches Cloud SQL (PostgreSQL 16) through a
Cloud SQL proxy sidecar on 127.0.0.1:5432. Secrets come from Secret Manager as files (`*_FILE`). Logs are structured JSON; every alert
on a log event filters on `jsonPayload.event`. The web is the only thing with an Ingress.

## First five minutes, for any alert

```sh
kubectl -n vercentlabs get pods -o wide
kubectl -n vercentlabs get events --sort-by=.lastTimestamp | tail -30
kubectl -n vercentlabs logs deploy/erp-worker -c worker --since=30m | grep -i '"severity":"ERROR"' | tail -50
kubectl -n vercentlabs logs deploy/vercentlabs-web -c web --since=30m | grep -i '"severity":"ERROR"' | tail -50
curl -fsS https://$APP_HOST/api/readiness   # 200 = config, database role, migrations and storage are all fine
```

Database access for the SQL below: `gcloud sql connect <instance> --user=<owner> --database=vercentlabs_control` (the migration
role). Every tenant table is behind row-level security; as the owner you see all companies, so **always filter by
`organization_id`** when changing rows. Write down what you changed in the incident notes.

## Releases and migrations

A release is: build the four images (web, worker, landing, migration) by digest → run the migration Job → roll out web and worker.

```sh
kubectl apply -f rendered/migration.yaml
kubectl -n vercentlabs wait --for=condition=complete --timeout=30m job/erp-migration-$RELEASE_SHA
kubectl -n vercentlabs logs job/erp-migration-$RELEASE_SHA -c migrate
```

- The Job (`infrastructure/kubernetes/jobs/migration.yaml`, `services/worker/bin/migrate.mjs`) applies only the migrations the
  database lacks, one file per transaction, under an advisory lock. Running it twice, or two at once, is safe.
- **If it fails:** the failing file rolled back on its own; everything before it is applied. The log names the file and the error.
  The new web pods stay unready (readiness lists the missing migration), and the old release keeps serving. Fix the migration in a
  new release and run the Job again. Never edit `public.schema_migrations` by hand to skip a file.
- `--dry-run` lists what would run: `kubectl run` the migration image with `node bin/migrate.mjs --dry-run`.
- One-off cleanup SQL (dropping retired tables) is not a migration file; it is run by hand with `psql -v ON_ERROR_STOP=1 -1 -f`
  and recorded in the release notes.

Roll back a bad release by rolling web and worker back to the previous digest (`kubectl rollout undo`). Migrations are
expand-only, so the previous release runs on the newer schema.

## Alerts

### worker-job-dead

A background job used up its attempts (`status = 'dead'`). The job type and error are in the log line and in the row.

```sql
SELECT id, organization_id, job_type, attempts, max_attempts, last_error, updated_at
  FROM tenant.background_jobs WHERE status = 'dead' AND updated_at > now() - interval '1 day' ORDER BY updated_at DESC;
```

- Read `last_error`. A bug needs a fix and a release first; a passing outage (SMTP, provider, storage) does not.
- Retry once the cause is gone, only for job types that are safe to repeat (all scheduled jobs and report exports are):
  ```sql
  UPDATE tenant.background_jobs SET status = 'pending', attempts = 0, run_at = now(), locked_by = NULL, lease_expires_at = NULL
   WHERE id = '<job id>' AND organization_id = '<company id>' AND status = 'dead';
  ```
- A dead scheduled job (follow-up reminders, low stock, project alerts, …) also recovers by itself on the next day's or tick's
  job; retrying is optional.

### webhook-delivery-dead

More than five outbound webhooks to a customer's endpoint gave up. Almost always the customer's endpoint (down, 4xx, TLS).

```sql
SELECT organization_id, subscription_id, count(*), max(last_status_code), max(last_error)
  FROM tenant.webhook_deliveries WHERE status = 'dead' AND updated_at > now() - interval '1 day' GROUP BY 1, 2;
```

Tell the company's owner which endpoint is failing. Once it is fixed, they redeliver from **Settings › Integrations › Webhooks**
(the redelivery is signed and counted). Nothing to do on our side unless every company's deliveries fail (then check egress /
the network policy).

### billing-webhook-dead

**Critical.** A Razorpay event could not be applied after its retries, so a payment or subscription change may be missing.

```sql
SELECT id, event_type, organization_id, processing_attempts, processing_error, created_at
  FROM public.billing_webhook_events WHERE processing_status = 'dead_lettered' ORDER BY created_at DESC LIMIT 20;
```

1. Compare with the Razorpay dashboard for that subscription or payment.
2. Fix the cause (usually a code bug → release, or a plan/price row the event refers to that is missing).
3. Replay it — the worker picks it up within a minute and applies it idempotently:
   ```sql
   UPDATE public.billing_webhook_events SET processing_status = 'failed', next_attempt_at = now(), dead_lettered_at = NULL
    WHERE id = '<event id>' AND processing_status = 'dead_lettered';
   ```
4. Check the company's billing page shows the right plan, seats and status.

### billing-recovery-failed

Reconciliation found the provider and our records disagree, or a checkout needs a person. The log line has the company, the
subscription and what differs. Check Razorpay, then the company's `billing_subscriptions` row. Do not hand-edit amounts: replay the
provider event (above) or let the next reconciliation run fix a status. If a customer paid and is locked out, tell billing@ at
once and replay or reconcile before anything else.

### storage-failure

File uploads or downloads are failing (`files.storage.failed`, `files.object.missing`).

- Check the bucket and the web's service account: `gcloud storage ls gs://$FILES_BUCKET | head`, and IAM on the bucket.
- `files.object.missing` for one file is a deleted or never-uploaded object: the record stays, the file is gone. Many at once means
  the wrong bucket is configured — check `FILES_BUCKET` in the web config map.
- The attachment scanner (`ATTACHMENT_SCAN_URL`) being down blocks new uploads only; downloads of scanned files keep working.

### readiness-failed

Web pods keep failing readiness. `curl https://$APP_HOST/api/readiness` (or a pod's `/api/readiness`) says which check:

- **migrations** — the database lacks an expected migration: the migration Job did not run or failed (see Releases).
- **database role** — the web connects with a role that is too powerful or wrong: check `DATABASE_URL` in Secret Manager.
- **configuration** — a required setting is missing; the pod log lists every problem at start.
- **storage** — see storage-failure.

### db-pool-waiting

Requests are waiting for a database connection. Look at Cloud SQL CPU and connections first (sql-cpu, sql-connections). Then:
slow queries (`log_min_duration_statement` is on — Cloud SQL logs), a stuck transaction
(`SELECT pid, now() - xact_start, state, left(query, 120) FROM pg_stat_activity WHERE state <> 'idle' ORDER BY 2 DESC;`), or simply
more traffic than `DATABASE_POOL_MAX` × replicas — scale the web out (HPA in `base/scaling.yaml`) before raising the pool, and keep
the total under the instance's `max_connections`.

### web-5xx

The load balancer saw more than five 5xx responses a minute for five minutes.

- Pod logs: `http.server_error` / `http.unhandled_error` lines carry the route and request id.
- All routes failing → database (see sql-*) or a bad release (roll back).
- One route failing → a bug: roll back if it matters, or ship a fix.
- 502/504 with healthy pods → the load balancer or a pod being killed mid-request (memory limits: `kubectl top pods`).

### crash-loop

A container restarted more than three times. `kubectl -n vercentlabs describe pod <pod>` gives the reason:

- `OOMKilled` → raise the memory limit in the manifest, then find the cause.
- Exit at start with configuration errors → the log lists them (a missing secret version is the usual one).
- `cloud-sql-proxy` restarting → the instance is unreachable or the service account lost `cloudsql.client`.

### worker-down

No worker container has been running for ten minutes. Nothing is lost — jobs, events and webhooks wait in the database — but
reminders, emails, billing maintenance and webhooks stop until it is back.

```sh
kubectl -n vercentlabs get deploy erp-worker
kubectl -n vercentlabs describe pods -l app=erp-worker | tail -40
```

A worker that starts and exits at once usually has a configuration or billing-provider problem (both are logged). When it comes back,
expired leases are reclaimed (`worker.lease.recovered`) and the backlog drains by itself.

### sql-cpu, sql-disk, sql-connections

- **cpu** above 85% for ten minutes: find the heavy queries (Query Insights). A sudden rise after a release is a missing index or a
  new N+1 — roll back. Steady growth means the tier (`sql_tier`) needs to grow.
- **disk** above 85%: storage auto-grows, but check what grew (`SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM
  pg_class ORDER BY pg_total_relation_size(oid) DESC LIMIT 15;`). Finished jobs, dispatched events and old notifications are the
  usual suspects.
- **connections** above 85% of `max_connections`: count by user (`SELECT usename, count(*) FROM pg_stat_activity GROUP BY 1;`).
  Too many from the web → reduce `DATABASE_POOL_MAX` or replicas; idle-in-transaction connections → find the code holding them.

### sql-unavailable

The Cloud SQL instance is down. Follow [DISASTER_RECOVERY_RUNBOOK.md](DISASTER_RECOVERY_RUNBOOK.md).

## Useful facts

- Company (tenant) id: `organizations.id`; every tenant row carries `organization_id`.
- Readiness: `/api/readiness` (web), `/readyz` (worker, port 8081). Liveness: `/api/health`, `/livez`.
- Logs never contain secrets or tokens (they are redacted at source); request ids join web and worker lines.
- Contacts: security@ for anything that looks like an attack or data exposure, billing@ for billing, support@ for customers.
