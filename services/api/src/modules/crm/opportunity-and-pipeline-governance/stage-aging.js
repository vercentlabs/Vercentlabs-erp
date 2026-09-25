import { resources } from "../crm-data-operations-and-customization/resource-registry.js";
import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { addParameter, camelizeRow } from "../crm-data-operations-and-customization/record-utils.js";

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

// F010 gap-closure (benchmark: "Opportunity pipeline management in top
// ERPs" report) — every reference ERP pushes bottleneck/funnel analytics to
// a separate reporting surface, and none of them build a stage-to-stage
// conversion metric into the Kanban board itself; the closest any of them
// get on-board is HubSpot's per-stage "Time in current stage" property.
// This gives the pipeline board a real, board-native bottleneck signal
// without inventing a full funnel/conversion-rate subsystem: one row per
// active stage with the open-Opportunity count, the AVERAGE age of every
// Opportunity currently sitting in that stage (not per-card — the
// aggregate signal a rep can act on: "Proposal is where deals stall"), and
// how many of those have already breached the same SLA precedence
// (policy.maximum_days, falling back to stage.stale_after_days) every
// other stalled-detection query in this codebase already uses.
export async function listOpportunityStageBottlenecks(client, context, pipelineId) {
  if (!pipelineId) return [];
  const parameters = [context.organizationId, pipelineId];
  const scope = recordScope(resources.opportunities, context, parameters, "o");
  const result = await client.query(
    `SELECT stage.id AS stage_id, stage.name, stage.sequence,
            COALESCE(stage_policy.maximum_days, stage.stale_after_days) AS maximum_days,
            count(o.id)::int AS opportunity_count,
            COALESCE(round(avg(EXTRACT(EPOCH FROM (now() - o.stage_entered_at)) / 86400)::numeric, 1), 0) AS average_age_days,
            count(*) FILTER (
              WHERE COALESCE(stage_policy.maximum_days, stage.stale_after_days) IS NOT NULL
                AND o.stage_entered_at <= now() - (COALESCE(stage_policy.maximum_days, stage.stale_after_days) || ' days')::interval
            )::int AS breached_count
       FROM tenant.crm_pipeline_stages stage
       LEFT JOIN tenant.crm_opportunity_stage_sla_policies stage_policy
         ON stage_policy.organization_id = stage.organization_id AND stage_policy.pipeline_id = stage.pipeline_id
        AND stage_policy.stage_id = stage.id AND stage_policy.status = 'active'
       LEFT JOIN tenant.crm_opportunities o
         ON o.organization_id = stage.organization_id AND o.stage_id = stage.id AND o.status = 'open'${scope}
      WHERE stage.organization_id = $1 AND stage.pipeline_id = $2 AND stage.status = 'active'
      GROUP BY stage.id, stage.name, stage.sequence, COALESCE(stage_policy.maximum_days, stage.stale_after_days)
      ORDER BY stage.sequence`,
    parameters,
  );
  return result.rows.map((row) => {
    const maximumDays = row.maximum_days == null ? null : Number(row.maximum_days);
    const averageAgeDays = Number(row.average_age_days || 0);
    const opportunityCount = Number(row.opportunity_count || 0);
    const breachedCount = Number(row.breached_count || 0);
    // A stage is a bottleneck when it actually holds deals AND either
    // breaches its own SLA on average or has at least one breached deal —
    // an empty or fast-moving stage is never flagged, matching the same
    // "no false positives on a healthy pipeline" discipline the per-
    // Opportunity computeStageAge status already applies.
    const isBottleneck =
      opportunityCount > 0 &&
      ((maximumDays != null && averageAgeDays >= maximumDays) || breachedCount > 0);
    return {
      stageId: row.stage_id,
      name: row.name,
      sequence: Number(row.sequence),
      opportunityCount,
      averageAgeDays,
      maximumDays,
      breachedCount,
      isBottleneck,
    };
  });
}

// F010 gap-closure — crm_opportunity_stage_sla_policies (migration 019) has
// been readable since day one (getCrmDashboard's stalled count, the
// Opportunity list's stalled=true filter, computeStageAge above) but had no
// create/update path anywhere and no admin UI: the auto-seeded, probability-
// tiered defaults (>=80% -> 7 days, >=40% -> 14, else 21) were permanently
// frozen at migration time for every pipeline that existed then, and any
// pipeline/stage created afterward got no policy row at all. This is the
// one place that governs it now, upserting by the table's own natural key
// (organization_id, pipeline_id, stage_id) rather than requiring callers to
// know a policy row's id.
export async function listStageSlaPolicies(client, context, pipelineId) {
  if (!pipelineId) return [];
  const result = await client.query(
    `SELECT stage.id AS stage_id, stage.name, stage.sequence, stage.stale_after_days,
            policy.id AS policy_id, policy.maximum_days, policy.status AS policy_status, policy.updated_at AS policy_updated_at
       FROM tenant.crm_pipeline_stages stage
       LEFT JOIN tenant.crm_opportunity_stage_sla_policies policy
         ON policy.organization_id = stage.organization_id AND policy.pipeline_id = stage.pipeline_id AND policy.stage_id = stage.id
      WHERE stage.organization_id = $1 AND stage.pipeline_id = $2 AND stage.status = 'active'
      ORDER BY stage.sequence`,
    [context.organizationId, pipelineId],
  );
  return result.rows.map((row) => ({
    stageId: row.stage_id,
    name: row.name,
    sequence: Number(row.sequence),
    fallbackDays: row.stale_after_days == null ? null : Number(row.stale_after_days),
    policyId: row.policy_id,
    overrideDays: row.maximum_days == null ? null : Number(row.maximum_days),
    overrideStatus: row.policy_status,
    updatedAt: row.policy_updated_at,
  }));
}

export async function upsertStageSlaPolicy(client, context, input = {}) {
  const pipelineId = String(input.pipelineId || "").trim();
  const stageId = String(input.stageId || "").trim();
  const status = input.status === "inactive" ? "inactive" : "active";
  const maximumDays = input.maximumDays == null || input.maximumDays === "" ? null : Number(input.maximumDays);
  if (!pipelineId || !stageId)
    throw new CrmError(400, "A pipeline and stage are required.", "CRM_STAGE_SLA_POLICY_INPUT_INVALID");
  if (status === "active" && !Number.isFinite(maximumDays))
    throw new CrmError(400, "SLA maximum days is required to activate a policy.", "CRM_STAGE_SLA_POLICY_INVALID_DAYS");
  if (maximumDays != null && (!Number.isFinite(maximumDays) || maximumDays < 1 || maximumDays > 3650))
    throw new CrmError(400, "SLA maximum days must be between 1 and 3650.", "CRM_STAGE_SLA_POLICY_INVALID_DAYS");
  const stage = (
    await client.query(
      `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND id=$2 AND pipeline_id=$3`,
      [context.organizationId, stageId, pipelineId],
    )
  ).rows[0];
  if (!stage) throw new CrmError(404, "Sales stage not found.", "CRM_STAGE_SLA_POLICY_STAGE_NOT_FOUND");
  const existing = (
    await client.query(
      `SELECT id, updated_at FROM tenant.crm_opportunity_stage_sla_policies WHERE organization_id=$1 AND pipeline_id=$2 AND stage_id=$3`,
      [context.organizationId, pipelineId, stageId],
    )
  ).rows[0];
  if (existing && input.expectedUpdatedAt) {
    const expected = new Date(input.expectedUpdatedAt).getTime();
    const actual = new Date(existing.updated_at).getTime();
    if (Number.isFinite(expected) && expected !== actual)
      throw new CrmError(
        409,
        "This SLA policy changed after you loaded it. Refresh and try again.",
        "CRM_STALE_WRITE",
      );
  }
  const result = await client.query(
    `INSERT INTO tenant.crm_opportunity_stage_sla_policies
       (organization_id, pipeline_id, stage_id, maximum_days, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (organization_id, pipeline_id, stage_id) DO UPDATE
       SET maximum_days = EXCLUDED.maximum_days, status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [context.organizationId, pipelineId, stageId, maximumDays ?? 14, status, context.userId],
  );
  return camelizeRow(result.rows[0]);
}
