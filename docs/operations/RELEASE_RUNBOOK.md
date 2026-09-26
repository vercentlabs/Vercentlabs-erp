# Release runbook

Exact release sequence for the Google Cloud deployment. Every step has a
command and a stop point. Nothing here is "remember to do later".

Audience: the engineer on release duty (needs GitHub `staging`/`production`
environment approval rights; `kubectl` access to the cluster for rollback).

## 0. Preconditions (stop if any fails)

| Check | Command / evidence | Stop if |
| --- | --- | --- |
| `main` is green | ERP CI + Infrastructure CI on the release commit | any red job |
| Production readiness (static) | `pnpm verify:production` | any FAIL |
| Production database suite | `pnpm test:production:db` (CI runs it) | any failure or skip |
| No destructive change in expand migrations | review new `database/*/migrations/*.sql`: no `DROP`, `RENAME`, type narrowing, `NOT NULL` without default | found → move it to a contract migration |
| Pending operations status | last release manifest `ops-status.json` → `blockers` | blockers that the release depends on |

Rolling compatibility rule: during a rollout the **old** application runs
against the **new** (expanded) schema and the **new** application runs until
all old pods are gone. Every expand migration must therefore be additive:
new tables/columns (nullable or defaulted), new indexes (`CONCURRENTLY` is not
possible inside the migration transaction — keep indexes small or ship them in
their own release), backfills that tolerate old writers. Renames and drops are
**expand → backfill → contract** across at least two releases.

## 1. Deploy (staging, then production)

1. GitHub → Actions → **Deploy** → *Run workflow* on `main`
   (`promote_to_production` = true to continue after staging).
2. The workflow, in order (stop points are automatic — a failure ends the run):
   1. ERP CI (full gate) on the commit.
   2. Build web, worker, migration and per-environment landing images; Trivy
      scan (fails on fixable CRITICAL).
   3. **Staging**: push to Artifact Registry (immutable tag = commit SHA),
      resolve digests, record the current images as the rollback target,
      run the **migration Job** (`db-migrate-<sha12>`: expand migrations +
      runtime role provisioning) and wait for completion —
      *a failed migration stops the release before any rollout* — then apply
      the manifests and wait for `web`, `erp-worker`, `landing` rollouts,
      smoke test through the load balancer, `ops:status` Job, release
      manifest artifact.
   4. **Production** waits for the environment approval (required reviewers),
      then repeats step 3 for production.
3. Review the `release-<environment>` artifact: `release-*.json` (commit,
   image digests, migration versions, rollback target), `smoke.json`,
   `ops-status.json`.

Stop and roll back (section 3) if the smoke test fails after a rollout, or
if the web 5xx / readiness alerts fire in the first 30 minutes.

## 2. Contract migrations (destructive, separate, explicit)

Contract migrations (`database/*/contracts/*.sql`) drop what an earlier
release made obsolete (legacy invitation columns, retired tables, attachment
bytes). They are **never** run by the deploy workflow.

Run only when: the release that stopped using the old structure has been
fully rolled out everywhere, `ops:status` shows no blockers for it
(e.g. `legacyFiles.rows = 0` before dropping attachment bytes), and a restore
rehearsal from the last 7 days passed.

Operations run as one-off Kubernetes Jobs with the migration authority
(`infrastructure/kubernetes/jobs/operations`). Helper used below and in
`PRODUCTION_RUNBOOK.md` (`deploy-values.json` = the environment's
`DEPLOY_VALUES_JSON`, `MIGRATION_IMAGE` = the migration image digest of the
running release from its release manifest):

```bash
export MIGRATION_IMAGE='<region>-docker.pkg.dev/<project>/<repo>/migration@sha256:<digest>'   # wins over deploy-values.json
run_operation() {  # run_operation <operation> [--dry-run]
  local id="ops-$(date -u +%Y%m%d%H%M%S)"
  OPERATION="$1" OPERATION_FLAGS="${2:-}" RELEASE_ID="$id" \
    node scripts/deploy/render-manifests.mjs --target operations --values deploy-values.json --out "/tmp/$id.yaml" || return 1
  kubectl apply -f "/tmp/$id.yaml"
  kubectl -n vercentlabs wait --for=condition=complete "job/ops-$1-$id" --timeout=60m
  kubectl -n vercentlabs logs "job/ops-$1-$id" -c operation
}

run_operation status          # blockers must be empty for the contract you run
run_operation contract-plan   # every file must print READY (checks only, rolled back)
run_operation contract-apply  # destructive; each contract re-checks its preconditions
```

A contract whose precondition fails raises an exception and changes nothing.
Stop there and fix the data (e.g. finish `files:migrate-legacy`), never edit
the contract to skip its check.

## 3. Rollback

Images are immutable digests; rollback never rebuilds.

```bash
kubectl -n vercentlabs rollout undo deployment/web
kubectl -n vercentlabs rollout undo deployment/erp-worker
kubectl -n vercentlabs rollout undo deployment/landing
kubectl -n vercentlabs rollout status deployment/web --timeout=10m
```

To go back further than one revision, set the digests from the target
release manifest's `rollbackTarget`:
`kubectl -n vercentlabs set image deployment/web web=<image@sha256:…>`.

Database: **forward-fix only**. Expand migrations are backward compatible,
so the previous application runs against the expanded schema. Never hand-run
`DROP`/`ALTER` to "undo" a migration and never edit a shipped migration file
(its checksum is recorded; the migration runner aborts on a changed file). A
bad migration is fixed by a new expand migration, or by a restore (see
`DISASTER_RECOVERY_RUNBOOK.md`) if data was damaged.

## 4. After the release

- Watch alerts for 30 minutes (web 5xx, readiness, crash loop, worker down).
- Keep the release artifact (400-day retention) — it is the audit record of
  what ran where.
- If `ops:status` lists new blockers, schedule the operations Job that clears
  them (`PRODUCTION_RUNBOOK.md`).
