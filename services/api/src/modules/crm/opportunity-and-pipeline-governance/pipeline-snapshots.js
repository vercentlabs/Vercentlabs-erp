import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { canViewAllCrmRecords } from "../crm-data-operations-and-customization/record-policy.js";

// F010 integrity closeout — historical pipeline snapshots (dossier
// F010-CAP-002 / DEC-CRM-P1-F010, a REQUIRED enterprise-scope item, not a
// manual-only convenience). Two capture modes share this same aggregation
// and persistence logic:
//   - "scheduled": the daily worker tick (services/worker/src/handlers/
//     crm-pipeline-snapshot-capture.js), one durable baseline per calendar
//     day, deduplicated by the database's own partial unique index (see
//     migration 100) rather than any application-level locking.
//   - "manual": an explicit manager-triggered capture, never deduplicated
//     by day (a manager may deliberately want more than one point-in-time
//     capture, e.g. before/after a pipeline review).
// Deliberately does NOT reuse crm_opportunity_forecast_snapshots — that
// table is a per-Opportunity point snapshot (forecast_category/probability/
// amount for one deal), not a pipeline-level stage aggregate; it does not
// model what this dossier requirement actually asks for.

const CURRENCY_FALLBACK = "INR";

async function activePipelineIds(client, context) {
  const result = await client.query(
    `SELECT id FROM tenant.crm_pipelines WHERE organization_id=$1 AND status='active'`,
    [context.organizationId],
  );
  return result.rows.map((row) => row.id);
}

// Deliberately org-wide, not recordScope()-filtered: a historical snapshot
// is a system-of-record artifact representing the pipeline's real state at
// that moment, not one caller's restricted view of it. The access boundary
// belongs on retrieval (listPipelineSnapshots below), not capture — a
// restricted seller who happens to trigger a manual capture must not
// thereby produce an incomplete/misleading historical record.
export async function capturePipelineSnapshots(client, context, options = {}) {
  const source = options.source === "manual" ? "manual" : "scheduled";
  const capturedBy = options.capturedBy ?? null;
  const snapshotDate = options.snapshotDate || new Date().toISOString().slice(0, 10);
  const pipelineIds = options.pipelineId
    ? [options.pipelineId]
    : await activePipelineIds(client, context);

  let rowsWritten = 0;
  let rowsSkippedDuplicate = 0;
  for (const pipelineId of pipelineIds) {
    // Bounded by construction: GROUP BY collapses an arbitrarily large
    // Opportunity set (including pipelines with >500 open Opportunities)
    // into one row per (company, stage, currency) combination — the
    // aggregate itself, never the underlying Opportunity rows, is what
    // gets processed and persisted.
    const aggregate = await client.query(
      `SELECT record.company_id, record.stage_id,
              COALESCE(record.currency_code, '${CURRENCY_FALLBACK}') AS currency_code,
              count(*)::int AS opportunity_count,
              COALESCE(sum(record.amount), 0)::numeric AS amount,
              COALESCE(sum(record.expected_revenue), 0)::numeric AS weighted_amount
         FROM tenant.crm_opportunities record
        WHERE record.organization_id=$1 AND record.pipeline_id=$2 AND record.status='open'
        GROUP BY record.company_id, record.stage_id, COALESCE(record.currency_code, '${CURRENCY_FALLBACK}')`,
      [context.organizationId, pipelineId],
    );
    for (const row of aggregate.rows) {
      const conflictClause =
        source === "scheduled"
          ? `ON CONFLICT (organization_id, pipeline_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), stage_id, currency_code, snapshot_date) WHERE source = 'scheduled' DO NOTHING`
          : "";
      const insertResult = await client.query(
        `INSERT INTO tenant.crm_pipeline_stage_snapshots(
           organization_id, pipeline_id, company_id, stage_id, currency_code, snapshot_date,
           opportunity_count, amount, weighted_amount, source, captured_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ${conflictClause}
         RETURNING id`,
        [
          context.organizationId,
          pipelineId,
          row.company_id,
          row.stage_id,
          row.currency_code,
          snapshotDate,
          row.opportunity_count,
          row.amount,
          row.weighted_amount,
          source,
          capturedBy,
        ],
      );
      if (insertResult.rows[0]) rowsWritten += 1;
      else rowsSkippedDuplicate += 1;
    }
  }

  await queueOutboxEvent(
    client,
    context,
    "crm.pipeline.snapshot_captured",
    "pipeline_snapshot",
    context.organizationId,
    { snapshotDate, source, pipelinesProcessed: pipelineIds.length, rowsWritten, rowsSkippedDuplicate },
  );

  return { snapshotDate, source, pipelinesProcessed: pipelineIds.length, rowsWritten, rowsSkippedDuplicate };
}

// Retrieval boundary (distinct from capture's deliberately org-wide scope):
// requires manager-level Opportunity permission — an ordinary seller
// (crm.view only) gets no access to aggregate pipeline history at all, not
// just a company-filtered slice of it, matching the dossier's "manager
// inspection" framing. A manager without org-wide visibility only sees
// their own active company's rows (or company-unassigned/org-wide rows),
// mirroring the live pipeline board's own companyVisible() boundary.
export async function listPipelineSnapshots(client, context, options = {}) {
  if (!context.permissions?.includes("crm.opportunities.manage") && !context.roleSlugs?.includes("organization_owner")) {
    throw new CrmError(403, "You do not have permission to view pipeline history.", "CRM_PIPELINE_SNAPSHOT_FORBIDDEN");
  }
  const pipelineId = options.pipelineId || null;
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(options.limit) || 30)));
  const parameters = [context.organizationId];
  let where = "snap.organization_id=$1";
  if (pipelineId) {
    parameters.push(pipelineId);
    where += ` AND snap.pipeline_id=$${parameters.length}`;
  }
  if (!canViewAllCrmRecords(context)) {
    if (context.activeCompanyId) {
      parameters.push(context.activeCompanyId);
      where += ` AND (snap.company_id IS NULL OR snap.company_id=$${parameters.length})`;
    } else if (!context.allowAllCompanies) {
      where += " AND false";
    }
  }
  parameters.push(limit);
  const result = await client.query(
    `SELECT snap.* FROM tenant.crm_pipeline_stage_snapshots snap
      WHERE ${where}
      ORDER BY snap.snapshot_date DESC, snap.captured_at DESC
      LIMIT $${parameters.length}`,
    parameters,
  );
  return result.rows;
}
