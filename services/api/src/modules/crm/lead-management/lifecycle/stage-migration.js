// F007 Lead lifecycle — safe stage deactivation. An administrator may not
// silently strand active Leads on a deactivated stage: deactivation is
// blocked while active Leads remain on the stage unless a replacement
// stage is nominated, which enqueues a governed, resumable background job
// (mirrors crm-lead-bulk-update.js's batching/idempotency pattern) that
// remaps each Lead through the canonical transitionLeadStage command
// before the stage can be deactivated.
import { CrmError, queueOutboxEvent, dto, lifecycleError, text, getLeadStage, isElevatedLifecycleActor } from "./shared.js";
import { transitionLeadStage } from "./transition-engine.js";

export const STAGE_MIGRATION_JOB_TYPE = "crm.leads.stage_migration";
export const STAGE_MIGRATION_BATCH_SIZE = 100;

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

// Deactivation attempt. If the stage has no active Leads, it deactivates
// immediately (unchanged from the pre-Prompt-4 behavior). If it does, and
// no migrateToStageId was given, it fails closed with the affected count
// rather than silently allowing leads to strand. If migrateToStageId is
// given, it enqueues the migration job and returns without deactivating —
// the caller must call this again once the job completes (its manifest
// will then show 0 active leads and deactivation will proceed).
export async function deactivateLeadStageWithMigration(client, context, id, options = {}) {
  try {
    const before = await getLeadStage(client, context, id);
    if (before.status === "inactive") return { deactivated: true, stage: before };
    if (before.isInitial)
      throw new CrmError(409, "The initial New stage cannot be deactivated.", "CRM_LEAD_STAGE_INITIAL_REQUIRED");
    const remaining = await client.query(
      "SELECT count(*)::int AS count FROM tenant.crm_lead_stages WHERE organization_id=$1 AND status='active' AND id<>$2",
      [context.organizationId, id],
    );
    if (!Number(remaining.rows[0]?.count))
      throw new CrmError(409, "At least one active Lead lifecycle stage is required.", "CRM_LEAD_STAGE_LAST_ACTIVE");
    const activeLeads = await client.query(
      "SELECT count(*)::int AS count FROM tenant.crm_leads WHERE organization_id=$1 AND status=$2 AND record_status='active'",
      [context.organizationId, before.code],
    );
    const affected = Number(activeLeads.rows[0]?.count || 0);
    if (affected > 0) {
      const migrateToStageId = text(options.migrateToStageId);
      if (!migrateToStageId)
        throw new CrmError(
          409,
          `${affected} active Lead(s) are on this stage. Choose a replacement stage to migrate them, or leave them and cancel.`,
          "CRM_LEAD_STAGE_HAS_ACTIVE_LEADS",
          { affectedCount: affected },
        );
      // F007 gap-closure — bulk-migrating every active Lead off a stage is
      // a destructive, wide-blast-radius action; it now requires the same
      // elevated pairing (organization owner or crm.records.view_all) as
      // the analogous override actions in F005/F006, not just the ordinary
      // settings-management permission that suffices for routine,
      // non-destructive catalogue/graph edits.
      if (!isElevatedLifecycleActor(context))
        throw new CrmError(
          403,
          "Migrating active Leads off a stage requires elevated permission.",
          "CRM_LEAD_STAGE_MIGRATION_FORBIDDEN",
        );
      const job = await enqueueLeadStageMigrationJob(client, context, id, migrateToStageId);
      return { deactivated: false, stage: before, migrationJob: job };
    }
    await client.query(
      "UPDATE tenant.crm_lead_stages SET status='inactive',updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id, context.userId],
    );
    const stage = await getLeadStage(client, context, id);
    await queueOutboxEvent(client, context, "crm.lead_stage.deactivated", "lead_stage", id, {
      stageId: id, code: before.code, leadCount: 0,
    });
    return { deactivated: true, stage };
  } catch (error) {
    throw lifecycleError(error);
  }
}

export async function enqueueLeadStageMigrationJob(client, context, fromStageId, toStageId) {
  const from = await getLeadStage(client, context, fromStageId);
  const to = await getLeadStage(client, context, toStageId);
  if (from.id === to.id)
    throw new CrmError(409, "Choose a different replacement stage.", "CRM_LEAD_STAGE_MIGRATION_SAME_STAGE");
  if (to.status !== "active")
    throw new CrmError(409, "The replacement stage must be active.", "CRM_LEAD_STAGE_MIGRATION_TARGET_INACTIVE");

  const idempotencyKey = `stage-migration:${from.id}:${to.id}`;
  const inserted = await client.query(
    `INSERT INTO tenant.background_jobs
       (organization_id,job_type,payload,status,run_at,priority,max_attempts,idempotency_key,requested_by,progress,result_manifest)
     VALUES($1,$2,$3::jsonb,'pending',now(),50,5,$4,$5,'{}'::jsonb,'{}'::jsonb)
     ON CONFLICT (organization_id,idempotency_key) DO NOTHING
     RETURNING *`,
    [
      context.organizationId,
      STAGE_MIGRATION_JOB_TYPE,
      JSON.stringify({ fromStageId: from.id, toStageId: to.id, requesterUserId: context.userId }),
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
    `INSERT INTO tenant.crm_lead_stage_migration_items(organization_id,job_id,lead_id,from_stage_id,to_stage_id,expected_updated_at)
     SELECT $1,$2,lead.id,$3,$4,lead.updated_at
       FROM tenant.crm_leads lead
      WHERE lead.organization_id=$1 AND lead.status=$5 AND lead.record_status='active'
     RETURNING id`,
    [context.organizationId, job.id, from.id, to.id, from.code],
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
  await queueOutboxEvent(client, context, "crm.lead_stage.migration_started", "lead_stage", from.id, {
    fromStageId: from.id, toStageId: to.id, jobId: job.id, affected: snapshot.rowCount,
  });
  return migrationJobProjection(job);
}

export async function getLeadStageMigrationJob(client, context, jobId) {
  const result = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2 AND job_type=$3`,
    [context.organizationId, jobId, STAGE_MIGRATION_JOB_TYPE],
  );
  if (!result.rows[0]) throw new CrmError(404, "Stage migration job not found.", "CRM_LEAD_STAGE_MIGRATION_JOB_NOT_FOUND");
  return migrationJobProjection(result.rows[0]);
}

function classifyMigrationItemError(error) {
  const status = Number(error?.status || 500);
  const code = String(error?.code || "CRM_LEAD_STAGE_MIGRATION_ITEM_FAILED");
  if (status === 409 && (code.includes("CONFLICT") || code.includes("VERSION")))
    return { status: "conflict", code, message: "Lead changed after the migration was queued." };
  if (status === 403 || status === 404)
    return { status: "skipped", code: "CRM_LEAD_STAGE_MIGRATION_SCOPE_CHANGED", message: "Lead is no longer available in scope." };
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
     FROM tenant.crm_lead_stage_migration_items
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

// Called by the worker handler (crm-lead-stage-migration.js) once per
// managed-transaction batch. Uses the SAME savepoint-per-item pattern as
// crm-lead-bulk-update.js so one bad Lead never aborts the whole batch.
export async function processLeadStageMigrationBatch(client, systemContext, jobId) {
  const pending = await client.query(
    `SELECT id,lead_id,from_stage_id,to_stage_id,expected_updated_at
       FROM tenant.crm_lead_stage_migration_items
      WHERE organization_id=$1 AND job_id=$2 AND status='pending'
      ORDER BY lead_id
      LIMIT $3
      FOR UPDATE SKIP LOCKED`,
    [systemContext.organizationId, jobId, STAGE_MIGRATION_BATCH_SIZE],
  );
  if (!pending.rows.length) {
    const manifest = await refreshMigrationManifest(client, systemContext.organizationId, jobId);
    if (manifest.pending > 0) throw new Error("Stage migration job still has pending items locked by another execution.");
    return { done: true, manifest };
  }
  for (const item of pending.rows) {
    await client.query("SAVEPOINT crm_lead_stage_migration_item");
    try {
      await transitionLeadStage(
        client,
        systemContext,
        item.lead_id,
        {
          stageId: item.to_stage_id,
          expectedUpdatedAt: new Date(item.expected_updated_at).toISOString(),
          requireVersion: true,
          note: "Migrated by governed stage deactivation.",
        },
        { skipTransitionGraphCheck: true, source: "api" },
      );
      await client.query("RELEASE SAVEPOINT crm_lead_stage_migration_item");
      await client.query(
        `UPDATE tenant.crm_lead_stage_migration_items SET status='applied',error_code=NULL,error_message=NULL,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [systemContext.organizationId, item.id],
      );
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_lead_stage_migration_item");
      await client.query("RELEASE SAVEPOINT crm_lead_stage_migration_item");
      const outcome = classifyMigrationItemError(error);
      await client.query(
        `UPDATE tenant.crm_lead_stage_migration_items SET status=$3,error_code=$4,error_message=$5,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [systemContext.organizationId, item.id, outcome.status, outcome.code, outcome.message],
      );
    }
  }
  const manifest = await refreshMigrationManifest(client, systemContext.organizationId, jobId);
  return { done: manifest.pending === 0, manifest };
}
