# Disaster recovery runbook

For whoever is on call when the database is down or data must be brought back. Day-to-day alerts are in
[PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md).

## What protects the data

Cloud SQL (`infrastructure/terraform/sql.tf`): automated daily backups (14 kept by default, `sql_backup_retention_days`),
point-in-time recovery from the transaction log (7 days by default, `sql_pitr_log_retention_days`), deletion protection on the
instance. Uploaded files are in the files bucket with its own versioning and retention (`storage.tf`).

## Cloud SQL unavailable (alert: sql-unavailable)

1. Check the instance and Google's status page: `gcloud sql instances describe <instance> --format='value(state)'`.
2. A zonal failure on a regional (HA) instance fails over by itself within a few minutes; the web and worker reconnect through
   their proxies. Watch `/api/readiness` come back.
3. While it is down: the web returns errors and the worker retries; nothing is half-written, because every request is one
   transaction. Put a status note up for customers if it lasts more than five minutes.
4. If the instance does not come back, restore into a new instance (below) and point the secrets at it.

## Restore the whole database to a point in time

Use this for corruption or a destructive mistake that affects many companies.

1. Pick the time just before the damage (from audit events, logs or the customer). Keep it in UTC.
2. Clone, never overwrite, the live instance:
   ```sh
   gcloud sql instances clone <instance> <instance>-restore-$(date +%Y%m%d%H%M) --point-in-time='2026-10-18T09:15:00Z'
   ```
3. Check the clone: the readiness checks against it, row counts of the affected tables, and that the damage is not there.
4. Either switch over (scale web and worker to 0, update the database URL secrets to the clone, run the migration Job, scale back
   up) or copy the lost rows back from the clone into the live instance (next section). Switching loses everything written after
   the chosen time, for every company — only do it when that is the smaller loss.

## Restore one company

One company's data can be put back as it was at a point in time without touching any other company, with
`services/worker/bin/restore-company.mjs`.

1. Make a point-in-time clone as above (or restore last night's dump into its own database). This is the **source**.
2. Find the company's id (`SELECT id, name FROM public.organizations WHERE name ILIKE '%…%'`).
3. Dry run against the live database (the **target**); it changes nothing and lists, per table, how many rows the backup has and how
   many the company has now:

   ```
   node services/worker/bin/restore-company.mjs --source "<clone URL>" --target "<live URL>" --organization <company id>
   ```
4. If the counts look right, tell the company the restore is starting (their users should stop working for a few minutes), then run the
   same command with `--apply`. In one transaction it deletes the company's current rows from every table that has an
   `organization_id` (public and tenant schemas), copies the backup's rows in, adds any of the company's people the target lacks, and
   puts the company's own row back. If anything fails, nothing is changed.
5. Run it as the database owner: it sets `session_replication_role = replica` for the copy (so foreign keys and triggers do not
   fire half way through). Row-level security is not disabled for anyone else.
6. Have someone from the company check the result before closing the incident. Record the command, the backup time and the row counts.

Notes: files are not in the database — recover their bytes from the bucket's object versions (below). Sessions of the company's users are
replaced by the backup's (old sessions from the backup are harmless: they expire; ask users to sign in again). Jobs and events that were
queued after the backup time are dropped with the rest of the company's rows.

## Files

A deleted file can be recovered from the bucket's object versions (`gcloud storage ls --all-versions gs://$FILES_BUCKET/<path>`)
within the retention period; the file record in the database points at the path.

## After any restore

- Run the migration Job against the restored database (it applies only what is missing).
- Check billing: reconcile subscriptions with Razorpay, since provider events after the restore point must be replayed.
- Write down the time chosen, what was lost and who was told.
