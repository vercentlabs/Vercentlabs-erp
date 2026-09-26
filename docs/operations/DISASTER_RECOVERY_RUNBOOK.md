# Disaster recovery runbook

What to do when a production dependency fails. Each scenario: detect →
decide → act → verify. Commands assume the setup in `PRODUCTION_RUNBOOK.md`
(`k` alias, `run_operation` from `RELEASE_RUNBOOK.md` §2).

Audience: on-call engineers and the engineering lead who declares an
incident.

## Recovery objectives

These are **internal engineering targets** derived from the configured
platform (`infrastructure/terraform/sql.tf`, `storage.tf`). They are not a
contractual customer SLA; no customer-facing commitment exists until the
business publishes one, and it must not be stricter than what a restore
rehearsal has demonstrated.

| Failure | RPO (data loss) | RTO (time to service) | Basis |
| --- | --- | --- | --- |
| Zone failure (production) | ~0 | minutes | Cloud SQL regional HA (synchronous standby, automatic failover); GKE Autopilot regional |
| Bad data change / bad migration | to the chosen point in time (seconds–minutes before the incident) | 1–4 h | PITR, 7-day transaction-log retention; clone → verify → cut over |
| Region outage (asia-south1) | up to the last automated backup (≤ 24 h) | 8–24 h | no cross-region replica is provisioned; rebuild in another region from backups |
| Accidental object deletion | 0 (within 14 days) | < 1 h per object | bucket versioning + 14-day soft delete |
| Lost/destroyed KMS key version | secrets encrypted only under that version | re-connect integrations | KMS versions are never destroyed while referenced (`ops:status`) |

A backup that exists is not proof of recoverability: the **Restore
rehearsal** workflow must pass at least monthly and after every change to
`sql.tf`; keep its evidence artifact.

## 1. Cloud SQL outage

Detect: alert "Cloud SQL unavailable", readiness `database` failed, web 5xx.

1. Check status: `gcloud sql instances describe <instance> --format='value(state,gceZone,failoverReplica)'`
   and the Google Cloud status page for Cloud SQL in the region.
2. **Zone failure** (production is `REGIONAL`): Cloud SQL fails over
   automatically (typically < 2 minutes). Pods reconnect through the Auth
   Proxy; nothing to do but watch readiness recover. If it does not fail over:
   `gcloud sql instances failover <instance>`.
3. **Instance unusable, region healthy**: restore to a new instance (§2) from
   the latest point in time, then cut over.
4. **Region outage**: declare an incident. Rebuild in a secondary region:
   create a Terraform environment with `region=<secondary>`, restore the most
   recent backup into it (`gcloud sql backups list --instance=<instance>`;
   `gcloud sql backups restore <backup-id> --restore-instance=<new-instance> --backup-instance=<instance>`
   — backups are stored multi-regionally by default unless `sql_backup_location`
   pins them), deploy the same release digests (release manifest), update DNS
   at the registrar. Expect data loss back to that backup.

Verify: readiness `ok`, smoke test (`node scripts/deploy/smoke.mjs --url https://<erp-host>`).

## 2. Database restore (bad migration, bad data change, corruption)

Never restore **over** the live instance. Clone, verify, then cut over.

1. Stop the damage: scale the worker to 0 if jobs are spreading the damage
   (`k scale deployment/erp-worker --replicas=0`); roll back the application
   if a release caused it (`RELEASE_RUNBOOK.md` §3).
2. Pick the point in time just before the incident (from logs/audit).
3. Clone: `gcloud sql instances clone <instance> <instance>-restore-<yyyymmddhhmm> --point-in-time=<RFC3339>`
   (or run the **Restore rehearsal** workflow with `point_in_time` and
   `keep_clone: true`).
4. Verify the clone: `SQL_CONNECTION_NAME=<clone connection name> run_operation restore-verify`
   → every check `ok` (schema, classification, forced RLS, tenant isolation as
   the web role, no orphaned rows).
5. Decide: either (a) copy the specific damaged data back from the clone
   with reviewed SQL, or (b) cut over to the clone: update the three
   `database-url-*` secrets only if hosts differ (they use 127.0.0.1 via the
   proxy — normally unchanged), change `SQL_CONNECTION_NAME` in the
   environment's `DEPLOY_VALUES_JSON`, redeploy the current release, and
   update `sql_*` Terraform to adopt the new instance.
6. Verify: readiness, smoke, `run_operation status`, scale the worker back.
7. Delete leftover clones (`gcloud sql instances patch <clone> --no-deletion-protection && gcloud sql instances delete <clone>`).

## 3. Application cluster outage

Detect: all pods down / GKE control plane errors / LB 502 with healthy DB.

- Single workload broken after a release → `RELEASE_RUNBOOK.md` §3 rollback.
- Cluster unusable: GKE Autopilot is regional; if it is unrecoverable,
  `terraform apply` recreates it (state is remote), then run the **Deploy**
  workflow for the last good commit — images are in Artifact Registry by
  digest, so nothing is rebuilt. The database and bucket are separate
  resources and unaffected.

## 4. Bad deployment

`RELEASE_RUNBOOK.md` §3: `kubectl rollout undo` for web/worker/landing
(previous digests are also in the release manifest's `rollbackTarget`).
Expand migrations are backward compatible, so the previous build runs on the
new schema. Never hand-edit the schema to "undo" a migration.

## 5. Bad database migration

- Migration Job failed: the rollout never started (the deploy workflow stops).
  Each migration runs in its own transaction and is recorded only on success;
  fix it with a new migration file (never edit a shipped file — checksums are
  enforced) and redeploy.
- Migration succeeded but damaged data: §2 (PITR to just before the Job ran;
  the Job's start time is in the deploy run and the release manifest).

## 6. Lost or rotated secret

- Secret value leaked: rotate it (`PRODUCTION_RUNBOOK.md` §3), restart the
  workloads, revoke the old value at the provider (Razorpay, SMTP, OAuth app).
- Secret version destroyed by mistake: add a new version with the correct
  value; pods pick it up on restart.
- Database password lost: as the migration role (Cloud SQL console / `gcloud
  sql users set-password` for `vercent_migrator`), set new passwords, update
  the three `database-url-*` secrets, run the migration Job (re-provisions
  runtime roles), restart.

## 7. KMS issue

Symptoms: OAuth token refresh / MFA / webhook signing fails with decrypt
errors; `secrets-reencrypt --dry-run` reports failures.

- Key version disabled by mistake: re-enable it
  (`gcloud kms keys versions enable <version> --key integration-secrets --keyring <ring> --location <region>`).
- Key version scheduled for destruction: cancel within the 24 h window
  (`gcloud kms keys versions restore ...`).
- Permission removed: restore `roles/cloudkms.cryptoKeyEncrypterDecrypter` for
  the web/worker/migration service accounts (`terraform apply`).
- Version truly destroyed: secrets encrypted only under it are lost; affected
  organisations reconnect OAuth accounts, re-enrol MFA and rotate webhook
  secrets. `ops:status` inventory shows which records reference which
  version.

## 8. Storage outage / object recovery

The files bucket has object versioning, a 14-day soft delete and a
30-day retention of noncurrent versions. Temporary artifacts (report
outputs, exports) carry an expiry: the worker deletes them when they expire
and they are regenerated, never recovered.

- Outage: readiness `objectStorage` fails; uploads/downloads fail
  (`files.storage.failed`). Nothing to do but wait for Cloud Storage; the
  application does not fall back to PostgreSQL.
- Accidentally deleted object (e.g. an archived attachment):
  `gcloud storage ls --all-versions gs://<bucket>/<key>` → copy the noncurrent
  version back: `gcloud storage cp gs://<bucket>/<key>#<generation> gs://<bucket>/<key>`;
  if the object itself was deleted and is in soft delete:
  `gcloud storage restore gs://<bucket>/<key>#<generation>`.
- Bulk check: `run_operation files-reconcile` lists missing objects and
  hash/size mismatches.

## 9. Provider outage (mail, OAuth, malware scanner)

- SMTP down: authentication emails fail; users retry; nothing is lost from
  the database. Switch SMTP settings (new secret + ConfigMap values) if the
  outage is long.
- Malware scanner down with `ATTACHMENT_SCAN_MODE=required`: uploads are
  refused (by design). Do not switch to `local` in production without a
  security decision recorded in the incident.
- OAuth provider down: connected-account sync fails and retries; nothing to do.

## 10. Webhook backlog

Symptoms: `webhook.delivery.failed/dead` growth, worker busy on deliveries.

1. Identify the endpoint(s) failing (worker logs: `organizationId`, status).
2. Pause deliveries for that organisation (feature flag
   `operator.webhooks / delivery_paused`); queued deliveries are kept.
3. Ask the customer to fix the endpoint; unpause; the worker drains the
   backlog with backoff. Dead deliveries can be redelivered from Settings →
   Integrations.

## 11. Billing provider (Razorpay) outage

- Checkout fails; existing subscriptions keep their state. Webhooks are
  stored first and applied by the worker; nothing is lost while Razorpay
  retries delivery.
- After recovery, the worker's billing maintenance reconciles subscriptions
  from the provider (`billing.reconciliation.*` events). Check the
  `billing-webhook-dead` / `billing-recovery-failed` alerts.
- Never grant access manually during the outage; enforcement follows the
  locally recorded subscription state and its grace periods.
