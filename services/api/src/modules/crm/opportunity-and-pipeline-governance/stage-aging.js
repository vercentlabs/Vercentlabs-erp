import { resources } from "../crm-data-operations-and-customization/resource-registry.js";
import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";

// F010 — authoritative per-stage pipeline totals. Integrity closeout
// (Prompts 1-5): the pipeline board previously derived its per-stage "open
// value" badges by summing row.amount over whatever Opportunity rows the
// page happened to load (capped at 500 across the whole pipeline) — correct
// only when a pipeline's true open-Opportunity count never exceeds that
// cap. This is a real, unbounded server-side GROUP BY aggregate,
// independent of any card-list pagination, so the totals stay correct no
// matter how many Opportunities the pipeline actually holds. Grouped by
// (stage, currency) rather than summed naively across currencies, matching
// the same discipline the pipeline board's own client-side stageValue()
// already applied to whatever slice it could see.
export async function listOpportunityPipelineStageTotals(client, context, pipelineId) {
  if (!pipelineId) return {};
  const parameters = [context.organizationId, pipelineId];
  const scope = recordScope(resources.opportunities, context, parameters, "record");
  const result = await client.query(
    `SELECT record.stage_id,
            COALESCE(record.currency_code, 'INR') AS currency_code,
            count(*)::int AS opportunity_count,
            COALESCE(sum(record.amount), 0)::numeric AS amount,
            COALESCE(sum(record.expected_revenue), 0)::numeric AS weighted_amount
       FROM tenant.crm_opportunities record
      WHERE record.organization_id = $1 AND record.pipeline_id = $2 AND record.status = 'open'${scope}
      GROUP BY record.stage_id, COALESCE(record.currency_code, 'INR')`,
    parameters,
  );
  const byStageId = {};
  for (const row of result.rows) {
    const stageId = String(row.stage_id);
    if (!byStageId[stageId]) byStageId[stageId] = { opportunityCount: 0, byCurrency: {} };
    byStageId[stageId].opportunityCount += Number(row.opportunity_count || 0);
    byStageId[stageId].byCurrency[row.currency_code] = {
      opportunityCount: Number(row.opportunity_count || 0),
      amount: Number(row.amount || 0),
      weightedAmount: Number(row.weighted_amount || 0),
    };
  }
  return byStageId;
}

// F010/F012 — real stage-age computation. Distinct from "inactivity"
// (evaluateOpportunityHealth's inactiveDays, based on last_activity_at):
// this answers "how long has this Opportunity been sitting in its CURRENT
// stage", sourced from the governed stage_entered_at column (written only
// by moveOpportunityStage — migration 098), never from mutable updated_at.
// The per-stage threshold prefers the existing crm_opportunity_stage_sla_
// policies table (previously defined but completely unused by any code)
// over crm_pipeline_stages.stale_after_days, so a configured SLA policy
// takes precedence over the coarser stage-level default.
export function computeStageAge(row, now = new Date()) {
  const enteredAt = row.stage_entered_at ? new Date(row.stage_entered_at) : null;
  const ageDays = enteredAt && !Number.isNaN(enteredAt.getTime())
    ? Math.max(0, Math.floor((now - enteredAt) / 86400000))
    : null;
  const maximumDays = row.sla_maximum_days != null
    ? Number(row.sla_maximum_days)
    : row.stale_after_days != null
      ? Number(row.stale_after_days)
      : null;
  const status = ageDays == null || maximumDays == null
    ? "unknown"
    : ageDays >= maximumDays
      ? "breached"
      : ageDays >= maximumDays * 0.75
        ? "warning"
        : "ok";
  return { enteredAt: enteredAt ? enteredAt.toISOString() : null, ageDays, maximumDays, status };
}

// Batch variant used by the pipeline board / opportunity list: one query,
// joined against both threshold sources, so N opportunities never cost N
// round trips.
export async function listOpportunityStageAges(client, context, pipelineId) {
  const values = [context.organizationId];
  let where = "record.organization_id=$1 AND record.status='open'";
  if (pipelineId) {
    values.push(pipelineId);
    where += ` AND record.pipeline_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT record.id AS opportunity_id, record.stage_entered_at,
            stage.stale_after_days,
            policy.maximum_days AS sla_maximum_days
       FROM tenant.crm_opportunities record
       LEFT JOIN tenant.crm_pipeline_stages stage
         ON stage.organization_id=record.organization_id AND stage.id=record.stage_id
       LEFT JOIN tenant.crm_opportunity_stage_sla_policies policy
         ON policy.organization_id=record.organization_id AND policy.pipeline_id=record.pipeline_id
        AND policy.stage_id=record.stage_id AND policy.status='active'
      WHERE ${where}`,
    values,
  );
  const now = new Date();
  const byOpportunityId = {};
  for (const row of result.rows) {
    byOpportunityId[row.opportunity_id] = computeStageAge(row, now);
  }
  return byOpportunityId;
}
