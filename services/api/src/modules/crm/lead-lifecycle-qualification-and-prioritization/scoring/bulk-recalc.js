// F027 Lead scoring — bulk recalculation job, triggered when a scoring
// model is activated. Mirrors crm-lead-bulk-update.js's and F007's
// stage-migration job pattern exactly: a background_jobs row + a per-lead
// item ledger, batched with FOR UPDATE SKIP LOCKED, savepoint-isolated per
// item so one bad Lead never aborts the batch, resumable/idempotent via the
// job's own idempotency key.
import { recalculateLeadScoreInternal } from "./scoring-engine.js";

export const SCORE_RECALC_JOB_TYPE = "crm.leads.score_recalc";
export const SCORE_RECALC_BATCH_SIZE = 100;

function recalcJobProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    jobType: row.job_type,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    progress: row.progress || {},
    resultManifest: row.result_manifest || {},
    lastError: row.status === "dead" ? String(row.last_error || "Score recalculation job failed.") : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function enqueueLeadScoreRecalcJob(client, context, modelId) {
  const idempotencyKey = `score-recalc:${modelId}:${Date.now()}`;
  const inserted = await client.query(
    `INSERT INTO tenant.background_jobs
       (organization_id,job_type,payload,status,run_at,priority,max_attempts,idempotency_key,requested_by,progress,result_manifest)
     VALUES($1,$2,$3::jsonb,'pending',now(),50,5,$4,$5,'{}'::jsonb,'{}'::jsonb)
     RETURNING *`,
    [context.organizationId, SCORE_RECALC_JOB_TYPE, JSON.stringify({ modelId, requesterUserId: context.userId }), idempotencyKey, context.userId],
  );
  const job = inserted.rows[0];
  const snapshot = await client.query(
    `INSERT INTO tenant.crm_lead_score_recalc_items(organization_id,job_id,lead_id)
     SELECT $1,$2,lead.id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.record_status='active'
     RETURNING id`,
    [context.organizationId, job.id],
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
    `UPDATE tenant.background_jobs SET progress=$3::jsonb,result_manifest=$3::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, job.id, JSON.stringify(manifest)],
  );
  return recalcJobProjection(updated.rows[0]);
}

export async function getLeadScoreRecalcJob(client, context, jobId) {
  const result = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2 AND job_type=$3`,
    [context.organizationId, jobId, SCORE_RECALC_JOB_TYPE],
  );
  return recalcJobProjection(result.rows[0]);
}

async function refreshRecalcManifest(client, organizationId, jobId) {
  const { rows } = await client.query(
    `SELECT
       count(*)::int AS requested,
       count(*) FILTER (WHERE status='pending')::int AS pending,
       count(*) FILTER (WHERE status='applied')::int AS applied,
       count(*) FILTER (WHERE status='conflict')::int AS conflict,
       count(*) FILTER (WHERE status='skipped')::int AS skipped,
       count(*) FILTER (WHERE status='failed')::int AS failed
     FROM tenant.crm_lead_score_recalc_items
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
    `UPDATE tenant.background_jobs SET progress=$3::jsonb,result_manifest=$3::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [organizationId, jobId, JSON.stringify(manifest)],
  );
  return manifest;
}

export async function processLeadScoreRecalcBatch(client, systemContext, jobId) {
  const pending = await client.query(
    `SELECT id,lead_id FROM tenant.crm_lead_score_recalc_items
      WHERE organization_id=$1 AND job_id=$2 AND status='pending'
      ORDER BY lead_id LIMIT $3 FOR UPDATE SKIP LOCKED`,
    [systemContext.organizationId, jobId, SCORE_RECALC_BATCH_SIZE],
  );
  if (!pending.rows.length) {
    const manifest = await refreshRecalcManifest(client, systemContext.organizationId, jobId);
    if (manifest.pending > 0) throw new Error("Score recalculation job still has pending items locked by another execution.");
    return { done: true, manifest };
  }
  for (const item of pending.rows) {
    await client.query("SAVEPOINT crm_lead_score_recalc_item");
    try {
      const before = await client.query(`SELECT score FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`, [systemContext.organizationId, item.lead_id]);
      const previousScore = Number(before.rows[0]?.score ?? 0);
      const result = await recalculateLeadScoreInternal(client, systemContext, item.lead_id, "Bulk recalculation: scoring model activated");
      await client.query("RELEASE SAVEPOINT crm_lead_score_recalc_item");
      await client.query(
        `UPDATE tenant.crm_lead_score_recalc_items SET status='applied',previous_score=$3,new_score=$4,error_code=NULL,error_message=NULL,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [systemContext.organizationId, item.id, previousScore, result?.score ?? previousScore],
      );
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_lead_score_recalc_item");
      await client.query("RELEASE SAVEPOINT crm_lead_score_recalc_item");
      await client.query(
        `UPDATE tenant.crm_lead_score_recalc_items SET status='failed',error_code=$3,error_message=$4,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [systemContext.organizationId, item.id, String(error?.code || "CRM_LEAD_SCORE_RECALC_ITEM_FAILED"), String(error?.message || "Recalculation failed.").slice(0, 500)],
      );
    }
  }
  const manifest = await refreshRecalcManifest(client, systemContext.organizationId, jobId);
  return { done: manifest.pending === 0, manifest };
}
