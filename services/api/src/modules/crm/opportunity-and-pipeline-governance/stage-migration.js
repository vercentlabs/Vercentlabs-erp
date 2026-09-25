// F012 — safe stage deactivation with a governed, resumable background
// migration job. Previously setSalesStageActive only ever hard-blocked
// deactivation while open Opportunities occupied the stage ("move them out
// first"), with no bulk remediation path — mirrors the exact
// crm_lead_stage_migration_items pattern built for F007 lead stages
// (CRM vNext Prompt 4) and crm-lead-bulk-update.js's savepoint-per-item
// batching, adapted for Opportunities.
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { isElevatedSalesStageActor, text } from "./shared.js";
import { getSalesStage, moveOpportunityStage, setSalesStageActive } from "../index.js";

export const OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE = "crm.opportunities.stage_migration";
export const OPPORTUNITY_STAGE_MIGRATION_BATCH_SIZE = 100;

function migrationJobProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    jobType: row.job_type,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    progress: row.progress || {},
    resultManifest: row.result_manifest || {},
    lastError: row.status === "dead" ? String(row.last_error || "Stage migration job failed.") : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

// F012 gap-closure (benchmark: "Sales stages configuration in top ERPs"
// report) — the entry point the deactivate route/UI actually calls.
// enqueueOpportunityStageMigrationJob and processOpportunityStageMigrationBatch
// below have existed, tested, and wired to a real worker handler
// (crm-opportunity-stage-migration.js) since this file was first written —
// but nothing ever called this one, the actual trigger, leaving the whole
// subsystem unreachable. Mirrors deactivateLeadStageWithMigration (F007
// lead-lifecycle/lifecycle/stage-migration.js) exactly: if the stage has no
// open Opportunities, delegate straight to the existing governed
// setSalesStageActive (unchanged behavior); if it does and no
// migrateToStageId is given, let setSalesStageActive's own existing
// CRM_SALES_STAGE_OPEN_OPPORTUNITIES error surface the affected count; if a
// replacement stage IS given, enqueue the migration job and return without
// deactivating — the caller must retry deactivation once the job empties
// the stage (its manifest will then show 0 open Opportunities).
export async function deactivateSalesStageWithMigration(client, context, id, options = {}) {
  const migrateToStageId = text(options.migrateToStageId);
  if (!migrateToStageId) {
    const stage = await setSalesStageActive(client, context, id, false, options.expectedUpdatedAt);
    return { deactivated: true, stage };
  }
  const before = await getSalesStage(client, context, id);
  if (before.status === "inactive") return { deactivated: true, stage: before };
  if (!Number(before.openOpportunityCount || 0)) {
    const stage = await setSalesStageActive(client, context, id, false, options.expectedUpdatedAt);
    return { deactivated: true, stage };
  }
  if (!isElevatedSalesStageActor(context))
    throw new CrmError(
      403,
      "Migrating open Opportunities off a stage requires elevated permission.",
      "CRM_SALES_STAGE_MIGRATION_FORBIDDEN",
    );
  const job = await enqueueOpportunityStageMigrationJob(client, context, id, migrateToStageId);
  return { deactivated: false, stage: before, migrationJob: job };
}

export async function enqueueOpportunityStageMigrationJob(client, context, fromStageId, toStageId) {
  const from = text(fromStageId);
  const to = text(toStageId);
  if (!from || !to) throw new CrmError(400, "Choose both a source and replacement stage.", "CRM_SALES_STAGE_MIGRATION_INPUT_INVALID");
  if (from === to) throw new CrmError(409, "Choose a different replacement stage.", "CRM_SALES_STAGE_MIGRATION_SAME_STAGE");
  const toResult = await client.query(
    `SELECT id,pipeline_id,status FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, to],
  );
  const toStage = toResult.rows[0];
  if (!toStage || toStage.status !== "active")
    throw new CrmError(409, "The replacement stage must be active.", "CRM_SALES_STAGE_MIGRATION_TARGET_INACTIVE");
  const fromResult = await client.query(
    `SELECT id,pipeline_id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, from],
  );
  if (!fromResult.rows[0] || fromResult.rows[0].pipeline_id !== toStage.pipeline_id)
    throw new CrmError(409, "The replacement stage must belong to the same pipeline.", "CRM_SALES_STAGE_MIGRATION_PIPELINE_MISMATCH");

  const idempotencyKey = `stage-migration:${from}:${to}`;
  const inserted = await client.query(
    `INSERT INTO tenant.background_jobs
       (organization_id,job_type,payload,status,run_at,priority,max_attempts,idempotency_key,requested_by,progress,result_manifest)
     VALUES($1,$2,$3::jsonb,'pending',now(),50,5,$4,$5,'{}'::jsonb,'{}'::jsonb)
     ON CONFLICT (organization_id,idempotency_key) DO NOTHING
     RETURNING *`,
    [
      context.organizationId,
      OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE,
      JSON.stringify({ fromStageId: from, toStageId: to, requesterUserId: context.userId }),
      idempotencyKey,
      context.userId,
    ],
  );
  let job = inserted.rows[0];
  if (!job) {
    const existing = await client.query(
      `SELECT * FROM tenant.background_jobs WHERE organization_id=$1 AND idempotency_key=$2`,
      [context.organizationId, idempotencyKey],
    );
    return migrationJobProjection(existing.rows[0]);
  }

  const snapshot = await client.query(
    `INSERT INTO tenant.crm_opportunity_stage_migration_items(organization_id,job_id,opportunity_id,from_stage_id,to_stage_id,expected_updated_at)
     SELECT $1,$2,record.id,$3,$4,record.updated_at
       FROM tenant.crm_opportunities record
      WHERE record.organization_id=$1 AND record.stage_id=$5 AND record.status='open'
     RETURNING id`,
    [context.organizationId, job.id, from, to, from],
  );
  const manifest = {
    requested: snapshot.rowCount,
    processed: 0,
    pending: snapshot.rowCount,
    applied: 0,
    conflict: 0,
    skipped: 0,
    failed: 0,
    percent: snapshot.rowCount ? 0 : 100,
  };
  const updated = await client.query(
    `UPDATE tenant.background_jobs SET progress=$3::jsonb,result_manifest=$3::jsonb,updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, job.id, JSON.stringify(manifest)],
  );
  job = updated.rows[0];
  await queueOutboxEvent(client, context, "crm.sales_stage.migration_started", "sales_stage", from, {
    fromStageId: from, toStageId: to, jobId: job.id, affected: snapshot.rowCount,
  });
  return migrationJobProjection(job);
}

export async function getOpportunityStageMigrationJob(client, context, jobId) {
  const result = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2 AND job_type=$3`,
    [context.organizationId, jobId, OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE],
  );
  if (!result.rows[0]) throw new CrmError(404, "Stage migration job not found.", "CRM_SALES_STAGE_MIGRATION_JOB_NOT_FOUND");
  return migrationJobProjection(result.rows[0]);
}

function classifyMigrationItemError(error) {
  const status = Number(error?.status || 500);
  const code = String(error?.code || "CRM_SALES_STAGE_MIGRATION_ITEM_FAILED");
  // moveOpportunityStage's own conflict codes (CRM_STALE_WRITE, CRM_STAGE_CONFLICT)
  // plus this job's own scope/pipeline codes and the archived/reopen-governance
  // codes it can also throw — all mean "re-snapshot and retry," not "broken."
  if (
    status === 409 &&
    (code.includes("CONFLICT") ||
      code.includes("STALE") ||
      code.includes("STAGE") ||
      code.includes("ARCHIVED") ||
      code.includes("REOPEN"))
  )
    return { status: "conflict", code, message: "Opportunity changed after the migration was queued." };
  if (status === 403 || status === 404)
    return { status: "skipped", code: "CRM_SALES_STAGE_MIGRATION_SCOPE_CHANGED", message: "Opportunity is no longer available in scope." };
  return {
    status: "failed",
    code,
    message: status >= 500 ? "Migration failed with a retryable server error." : String(error?.message || "Migration failed.").slice(0, 500),
  };
}

async function refreshMigrationManifest(client, organizationId, jobId) {
  const { rows } = await client.query(
    `SELECT
       count(*)::int AS requested,
       count(*) FILTER (WHERE status='pending')::int AS pending,
       count(*) FILTER (WHERE status='applied')::int AS applied,
       count(*) FILTER (WHERE status='conflict')::int AS conflict,
       count(*) FILTER (WHERE status='skipped')::int AS skipped,
       count(*) FILTER (WHERE status='failed')::int AS failed
     FROM tenant.crm_opportunity_stage_migration_items
     WHERE organization_id=$1 AND job_id=$2`,
    [organizationId, jobId],
  );
  const counts = rows[0] || {};
  const requested = Number(counts.requested || 0);
  const pending = Number(counts.pending || 0);
  const processed = Math.max(0, requested - pending);
  const manifest = {
    requested,
    processed,
    pending,
    applied: Number(counts.applied || 0),
    conflict: Number(counts.conflict || 0),
    skipped: Number(counts.skipped || 0),
    failed: Number(counts.failed || 0),
    percent: requested ? Math.min(100, Math.round((processed / requested) * 100)) : 100,
  };
  await client.query(
    `UPDATE tenant.background_jobs SET progress=$3::jsonb,result_manifest=$3::jsonb,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [organizationId, jobId, JSON.stringify(manifest)],
  );
  return manifest;
}

// Called by the worker handler once per managed-transaction batch. Uses the
// same savepoint-per-item pattern as crm-lead-bulk-update.js/F007's stage
// migration so one bad Opportunity never aborts the whole batch.
export async function processOpportunityStageMigrationBatch(client, systemContext, jobId) {
  const pending = await client.query(
    `SELECT id,opportunity_id,to_stage_id,expected_updated_at
       FROM tenant.crm_opportunity_stage_migration_items
      WHERE organization_id=$1 AND job_id=$2 AND status='pending'
      ORDER BY opportunity_id
      LIMIT $3
      FOR UPDATE SKIP LOCKED`,
    [systemContext.organizationId, jobId, OPPORTUNITY_STAGE_MIGRATION_BATCH_SIZE],
  );
  if (!pending.rows.length) {
    const manifest = await refreshMigrationManifest(client, systemContext.organizationId, jobId);
    if (manifest.pending > 0) throw new Error("Stage migration job still has pending items locked by another execution.");
    return { done: true, manifest };
  }
  for (const item of pending.rows) {
    await client.query("SAVEPOINT crm_opportunity_stage_migration_item");
    try {
      await moveOpportunityStage(
        client,
        systemContext,
        item.opportunity_id,
        item.to_stage_id,
        "Migrated by governed stage deactivation.",
        { expectedUpdatedAt: new Date(item.expected_updated_at).toISOString() },
      );
      await client.query("RELEASE SAVEPOINT crm_opportunity_stage_migration_item");
      await client.query(
        `UPDATE tenant.crm_opportunity_stage_migration_items SET status='applied',error_code=NULL,error_message=NULL,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [systemContext.organizationId, item.id],
      );
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_opportunity_stage_migration_item");
      await client.query("RELEASE SAVEPOINT crm_opportunity_stage_migration_item");
      const outcome = classifyMigrationItemError(error);
      await client.query(
        `UPDATE tenant.crm_opportunity_stage_migration_items SET status=$3,error_code=$4,error_message=$5,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [systemContext.organizationId, item.id, outcome.status, outcome.code, outcome.message],
      );
    }
  }
  const manifest = await refreshMigrationManifest(client, systemContext.organizationId, jobId);
  return { done: manifest.pending === 0, manifest };
}
