import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { createHash } from "node:crypto";
import { resources } from "../index.js";

export const CRM_OPPORTUNITY_REVENUE_CAPABILITY_IDS = Object.freeze([
  "CRM-051",
  "CRM-052",
  "CRM-053",
  "CRM-073",
  "CRM-074",
  "CRM-075",
  "CRM-076",
  "CRM-077",
]);

export class CrmOpportunityRevenueError extends Error {
  constructor(
    status,
    message,
    code = "CRM_OPPORTUNITY_REVENUE_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "CrmOpportunityRevenueError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const text = (value) => String(value ?? "").trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const round2 = (value) =>
  Math.round((number(value) + Number.EPSILON) * 100) / 100;

export function crmOpportunityRevenueHash(value) {
  const stable = (input) => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, stable(input[key])]),
      );
    }
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function addInterval(date, interval, count) {
  const next = new Date(date);
  if (interval === "year") next.setUTCFullYear(next.getUTCFullYear() + count);
  else if (interval === "quarter")
    next.setUTCMonth(next.getUTCMonth() + count * 3);
  else if (interval === "week") next.setUTCDate(next.getUTCDate() + count * 7);
  else next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

export function allocateExactAmounts(totalValue, weightsValue) {
  const totalCents = Math.round(number(totalValue) * 100);
  const weights = array(weightsValue).map((value) =>
    Math.max(0, number(value)),
  );
  if (!weights.length || weights.every((value) => value === 0)) {
    throw new CrmOpportunityRevenueError(
      400,
      "At least one positive allocation weight is required.",
      "CRM_REVENUE_WEIGHTS_INVALID",
    );
  }
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const raw = weights.map((weight) => (totalCents * weight) / totalWeight);
  const cents = raw.map(Math.floor);
  let remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || left.index - right.index,
    );
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    cents[order[index % order.length].index] += 1;
  }
  return cents.map((value) => value / 100);
}

export function buildRecurringRevenueSchedule(input = {}) {
  const totalAmount = round2(input.totalAmount);
  const periods = Math.trunc(number(input.periods));
  const interval = text(input.interval || "month");
  const startDate = new Date(input.startDate || Date.now());
  if (totalAmount < 0 || periods < 1 || periods > 120) {
    throw new CrmOpportunityRevenueError(
      400,
      "Recurring revenue requires a non-negative amount and 1 to 120 periods.",
      "CRM_RECURRING_REVENUE_INVALID",
    );
  }
  if (!["week", "month", "quarter", "year"].includes(interval)) {
    throw new CrmOpportunityRevenueError(
      400,
      "Unsupported recurring-revenue interval.",
      "CRM_RECURRING_INTERVAL_INVALID",
    );
  }
  if (Number.isNaN(startDate.getTime())) {
    throw new CrmOpportunityRevenueError(
      400,
      "A valid recurring-revenue start date is required.",
      "CRM_RECURRING_START_DATE_INVALID",
    );
  }
  const amounts = allocateExactAmounts(totalAmount, Array(periods).fill(1));
  return amounts.map((amount, index) => ({
    sequence: index + 1,
    scheduleDate: addInterval(startDate, interval, index)
      .toISOString()
      .slice(0, 10),
    amount,
  }));
}

export function validateRevenueSplits(splitsValue) {
  const splits = array(splitsValue).map((split) => ({
    userId: text(split.userId || split.user_id),
    role: text(split.role || "contributor"),
    splitType: text(split.splitType || split.split_type || "revenue"),
    percent: round2(split.percent),
  }));
  if (!splits.length) {
    throw new CrmOpportunityRevenueError(
      400,
      "At least one revenue split is required.",
      "CRM_REVENUE_SPLITS_EMPTY",
    );
  }
  const seen = new Set();
  for (const split of splits) {
    if (!split.userId || split.percent <= 0 || split.percent > 100) {
      throw new CrmOpportunityRevenueError(
        400,
        "Each split requires a user and a percentage between 0 and 100.",
        "CRM_REVENUE_SPLIT_INVALID",
      );
    }
    const key = `${split.userId}:${split.splitType}`;
    if (seen.has(key)) {
      throw new CrmOpportunityRevenueError(
        409,
        "A user can appear only once per split type.",
        "CRM_REVENUE_SPLIT_DUPLICATE",
      );
    }
    seen.add(key);
  }
  const byType = new Map();
  for (const split of splits) {
    byType.set(
      split.splitType,
      round2((byType.get(split.splitType) || 0) + split.percent),
    );
  }
  const invalid = [...byType.entries()].filter(
    ([, total]) => Math.abs(total - 100) > 0.001,
  );
  if (invalid.length) {
    throw new CrmOpportunityRevenueError(
      400,
      "Revenue splits must total exactly 100 percent for each split type.",
      "CRM_REVENUE_SPLITS_NOT_BALANCED",
      invalid.map(([splitType, total]) => ({ splitType, total })),
    );
  }
  return splits;
}

export function evaluateMutualActionPlan(planValue, nowValue = new Date()) {
  const plan = object(planValue);
  const milestones = array(plan.milestones);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const required = milestones.filter(
    (milestone) => milestone.required !== false,
  );
  const completed = milestones.filter(
    (milestone) => milestone.status === "completed",
  );
  const overdue = milestones.filter(
    (milestone) =>
      milestone.status !== "completed" &&
      milestone.dueDate &&
      new Date(milestone.dueDate) < now,
  );
  const ownerless = milestones.filter(
    (milestone) =>
      !text(milestone.internalOwnerUserId) &&
      !text(milestone.customerOwnerName),
  );
  const requiredIncomplete = required.filter(
    (milestone) => milestone.status !== "completed",
  );
  return {
    ready:
      requiredIncomplete.length === 0 &&
      overdue.length === 0 &&
      ownerless.length === 0,
    total: milestones.length,
    completed: completed.length,
    overdue: overdue.length,
    ownerless: ownerless.length,
    requiredIncomplete: requiredIncomplete.length,
    completionPercent: milestones.length
      ? Math.round((completed.length / milestones.length) * 100)
      : 0,
  };
}

export function calculatePredictiveForecast(input = {}) {
  const opportunities = array(input.opportunities);
  const historicalWinRate = Math.min(
    1,
    Math.max(0, number(input.historicalWinRate, 0.35)),
  );
  let predictedAmount = 0;
  let pipelineAmount = 0;
  const rows = opportunities.map((opportunity) => {
    const amount = Math.max(0, number(opportunity.amount));
    const probability =
      Math.min(100, Math.max(0, number(opportunity.probability))) / 100;
    const health = Math.min(
      1,
      Math.max(
        0,
        number(opportunity.healthScore ?? opportunity.health_score, 60) / 100,
      ),
    );
    const ageDays = Math.max(
      0,
      number(opportunity.ageDays ?? opportunity.age_days),
    );
    const activityFactor = Math.max(0.45, 1 - Math.min(ageDays, 90) / 180);
    const closeFactor =
      opportunity.closeOverdue || opportunity.close_overdue ? 0.7 : 1;
    const modelProbability = Math.min(
      0.99,
      Math.max(
        0.01,
        probability * 0.5 + historicalWinRate * 0.25 + health * 0.25,
      ),
    );
    const predicted = round2(
      amount * modelProbability * activityFactor * closeFactor,
    );
    pipelineAmount += amount;
    predictedAmount += predicted;
    return {
      opportunityId: opportunity.id || null,
      amount: round2(amount),
      predictedAmount: predicted,
      predictedProbability: round2(modelProbability * 100),
      factors: {
        probability,
        historicalWinRate,
        health,
        activityFactor,
        closeFactor,
      },
    };
  });
  const confidence =
    opportunities.length >= 20 ? 85 : opportunities.length >= 5 ? 70 : 55;
  return {
    pipelineAmount: round2(pipelineAmount),
    predictedAmount: round2(predictedAmount),
    confidence,
    opportunityCount: rows.length,
    rows,
    modelVersion: "crm-opportunity-forecast-v1",
  };
}

export function allocateQuotaSeasonality(input = {}) {
  const total = round2(input.totalAmount);
  const weights = array(input.weights).map((entry, index) => ({
    periodKey: text(entry.periodKey || entry.period_key || `P${index + 1}`),
    weight: Math.max(0, number(entry.weight)),
  }));
  const amounts = allocateExactAmounts(
    total,
    weights.map((entry) => entry.weight),
  );
  return weights.map((entry, index) => ({
    periodKey: entry.periodKey,
    weight: entry.weight,
    targetAmount: amounts[index],
  }));
}

export function cloneOpportunityBlueprint(sourceValue, optionsValue = {}) {
  const source = object(sourceValue);
  const options = object(optionsValue);
  const customData = object(source.custom_data || source.customData);
  return {
    code: text(options.code),
    name: text(options.name || `${text(source.name)} Copy`),
    pipelineId: source.pipeline_id || source.pipelineId,
    stageId:
      options.stageId || options.stage_id || source.stage_id || source.stageId,
    partyId: source.party_id || source.partyId || null,
    contactId: source.contact_id || source.contactId || null,
    ownerUserId:
      options.ownerUserId || source.owner_user_id || source.ownerUserId || null,
    description: source.description || null,
    amount: options.copyAmount === false ? 0 : number(source.amount),
    currencyCode: source.currency_code || source.currencyCode || null,
    probability: number(options.probability, number(source.probability)),
    expectedCloseDate: options.expectedCloseDate || null,
    forecastCategory: "pipeline",
    nextStep: options.nextStep || null,
    customData: { ...customData, clonedFromOpportunityId: source.id || null },
  };
}

export function summarizeWinLoss(rowsValue) {
  const rows = array(rowsValue);
  const result = {
    total: rows.length,
    won: 0,
    lost: 0,
    byReason: {},
    byCompetitor: {},
    averageCycleDays: 0,
  };
  let cycleDays = 0;
  for (const row of rows) {
    const outcome = text(row.outcome);
    if (outcome === "won") result.won += 1;
    if (outcome === "lost") result.lost += 1;
    const reason = text(
      row.primaryReason || row.primary_reason || "Unspecified",
    );
    result.byReason[reason] = (result.byReason[reason] || 0) + 1;
    const competitor = text(row.competitorName || row.competitor_name);
    if (competitor)
      result.byCompetitor[competitor] =
        (result.byCompetitor[competitor] || 0) + 1;
    cycleDays += Math.max(
      0,
      number(row.salesCycleDays || row.sales_cycle_days),
    );
  }
  result.averageCycleDays = rows.length
    ? Math.round(cycleDays / rows.length)
    : 0;
  return result;
}

async function requireOpportunity(client, context, opportunityId) {
  // Company/branch/owner record scope, not just organization — this was a
  // real gap found this prompt: every function in this file previously
  // only checked organization_id, meaning any authenticated actor holding
  // crm.opportunities.manage (regardless of their own company/branch/team/
  // owner scope) could read or write revenue schedules, splits, team
  // membership, mutual action plans and win/loss reviews for ANY
  // opportunity in the organization. Mirrors the same recordScope() every
  // other Opportunity write path (moveOpportunityStage,
  // updateOpportunityProbability, the generic CRUD routes) already applies.
  const parameters = [context.organizationId, opportunityId];
  const result = await client.query(
    `SELECT record.* FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.id=$2${recordScope(resources.opportunities, context, parameters)} FOR UPDATE`,
    parameters,
  );
  if (!result.rows[0]) {
    throw new CrmOpportunityRevenueError(
      404,
      "Opportunity not found.",
      "CRM_OPPORTUNITY_NOT_FOUND",
    );
  }
  return result.rows[0];
}

export async function saveOpportunityRecurringRevenue(
  client,
  context,
  input = {},
) {
  const opportunityItemId = text(input.opportunityItemId);
  const itemResult = await client.query(
    `SELECT oi.id,oi.opportunity_id,oi.line_total,o.status
       FROM tenant.crm_opportunity_items oi
       JOIN tenant.crm_opportunities o ON o.organization_id=oi.organization_id AND o.id=oi.opportunity_id
      WHERE oi.organization_id=$1 AND oi.id=$2 FOR UPDATE`,
    [context.organizationId, opportunityItemId],
  );
  const item = itemResult.rows[0];
  if (!item)
    throw new CrmOpportunityRevenueError(
      404,
      "Opportunity item not found.",
      "CRM_OPPORTUNITY_ITEM_NOT_FOUND",
    );
  if (!["open", "won"].includes(text(item.status))) {
    throw new CrmOpportunityRevenueError(
      409,
      "Recurring revenue cannot be changed for this opportunity status.",
      "CRM_RECURRING_REVENUE_LOCKED",
    );
  }
  const schedule = buildRecurringRevenueSchedule({
    totalAmount: input.totalAmount ?? item.line_total,
    periods: input.periods,
    interval: input.interval,
    startDate: input.startDate,
  });
  await client.query(
    `DELETE FROM tenant.crm_opportunity_revenue_schedules WHERE organization_id=$1 AND opportunity_item_id=$2`,
    [context.organizationId, opportunityItemId],
  );
  for (const row of schedule) {
    await client.query(
      `INSERT INTO tenant.crm_opportunity_revenue_schedules
       (organization_id,opportunity_id,opportunity_item_id,sequence,schedule_date,amount,currency_code,recurrence_interval,created_by,updated_by)
       SELECT $1,oi.opportunity_id,oi.id,$3,$4,$5,o.currency_code,$6,$7,$7
         FROM tenant.crm_opportunity_items oi
         JOIN tenant.crm_opportunities o ON o.organization_id=oi.organization_id AND o.id=oi.opportunity_id
        WHERE oi.organization_id=$1 AND oi.id=$2`,
      [
        context.organizationId,
        opportunityItemId,
        row.sequence,
        row.scheduleDate,
        row.amount,
        text(input.interval || "month"),
        context.userId,
      ],
    );
  }
  return {
    opportunityItemId,
    opportunityId: item.opportunity_id,
    rows: schedule,
  };
}

export async function saveOpportunityRevenueSplits(
  client,
  context,
  input = {},
) {
  const opportunityId = text(input.opportunityId);
  await requireOpportunity(client, context, opportunityId);
  const splits = validateRevenueSplits(input.splits);
  // Replace only the split rows for the split TYPE(s) present in this save —
  // never delete-all-team-members-then-recreate. That destroyed any team
  // member (e.g. a view-only observer, or one holding a split of a
  // *different* type not included in this call) who happened not to be in
  // this particular payload — a real bug found this prompt, since the
  // opportunity team was previously only ever manageable as a side effect
  // of saving revenue splits, with no standalone team-membership concept.
  const splitTypes = [...new Set(splits.map((split) => split.splitType))];
  await client.query(
    `DELETE FROM tenant.crm_opportunity_revenue_splits
      WHERE organization_id=$1 AND opportunity_id=$2 AND split_type=ANY($3::text[])`,
    [context.organizationId, opportunityId, splitTypes],
  );
  for (const split of splits) {
    // Upsert the team-member row (a split's user must be on the team), but
    // never downgrade an existing access_level — only new rows default to
    // 'edit'; a manager added separately (addOpportunityTeamMember) keeps
    // their access_level even if later included in a revenue split too.
    const member = await client.query(
      `INSERT INTO tenant.crm_opportunity_team_members
       (organization_id,opportunity_id,user_id,team_role,access_level,created_by,updated_by)
       VALUES($1,$2,$3,$4,'edit',$5,$5)
       ON CONFLICT(organization_id,opportunity_id,user_id)
       DO UPDATE SET team_role=EXCLUDED.team_role,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING id`,
      [
        context.organizationId,
        opportunityId,
        split.userId,
        split.role,
        context.userId,
      ],
    );
    await client.query(
      `INSERT INTO tenant.crm_opportunity_revenue_splits
       (organization_id,opportunity_id,team_member_id,split_type,split_percent,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (organization_id,opportunity_id,team_member_id,split_type)
       DO UPDATE SET split_percent=EXCLUDED.split_percent,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [
        context.organizationId,
        opportunityId,
        member.rows[0].id,
        split.splitType,
        split.percent,
        context.userId,
      ],
    );
  }
  return { opportunityId, splits };
}

export async function saveMutualActionPlan(client, context, input = {}) {
  const opportunityId = text(input.opportunityId);
  await requireOpportunity(client, context, opportunityId);
  const milestones = array(input.milestones).map((row, index) => ({
    title: text(row.title),
    sequence: index + 1,
    dueDate: row.dueDate || null,
    internalOwnerUserId: row.internalOwnerUserId || null,
    customerOwnerName: text(row.customerOwnerName) || null,
    required: row.required !== false,
    status: text(row.status || "planned"),
    completionEvidence: object(row.completionEvidence),
  }));
  if (
    !text(input.name) ||
    !milestones.length ||
    milestones.some((row) => !row.title)
  ) {
    throw new CrmOpportunityRevenueError(
      400,
      "A named action plan with titled milestones is required.",
      "CRM_ACTION_PLAN_INVALID",
    );
  }
  const planResult = await client.query(
    `INSERT INTO tenant.crm_mutual_action_plans
     (organization_id,opportunity_id,name,customer_visible,status,target_close_date,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT(organization_id,opportunity_id)
     DO UPDATE SET name=EXCLUDED.name,customer_visible=EXCLUDED.customer_visible,status=EXCLUDED.status,target_close_date=EXCLUDED.target_close_date,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING id`,
    [
      context.organizationId,
      opportunityId,
      text(input.name),
      input.customerVisible !== false,
      text(input.status || "active"),
      input.targetCloseDate || null,
      context.userId,
    ],
  );
  const planId = planResult.rows[0].id;
  await client.query(
    `DELETE FROM tenant.crm_mutual_action_plan_milestones WHERE organization_id=$1 AND plan_id=$2`,
    [context.organizationId, planId],
  );
  for (const row of milestones) {
    await client.query(
      `INSERT INTO tenant.crm_mutual_action_plan_milestones
       (organization_id,plan_id,sequence,title,due_date,internal_owner_user_id,customer_owner_name,required,status,completion_evidence,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11)`,
      [
        context.organizationId,
        planId,
        row.sequence,
        row.title,
        row.dueDate,
        row.internalOwnerUserId,
        row.customerOwnerName,
        row.required,
        row.status,
        JSON.stringify(row.completionEvidence),
        context.userId,
      ],
    );
  }
  return {
    planId,
    opportunityId,
    evaluation: evaluateMutualActionPlan({ milestones }),
  };
}

export async function cloneOpportunity(
  client,
  context,
  sourceOpportunityId,
  input = {},
) {
  const source = await requireOpportunity(client, context, sourceOpportunityId);
  const blueprint = cloneOpportunityBlueprint(source, input);
  if (!blueprint.code || !blueprint.name) {
    throw new CrmOpportunityRevenueError(
      400,
      "A unique opportunity code and name are required for cloning.",
      "CRM_OPPORTUNITY_CLONE_INVALID",
    );
  }
  const clone = await client.query(
    `INSERT INTO tenant.crm_opportunities
     (organization_id,company_id,branch_id,code,pipeline_id,stage_id,party_id,contact_id,campaign_id,source_id,owner_user_id,name,description,amount,currency_code,probability,expected_close_date,status,forecast_category,next_step,custom_data,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'open',$18,$19,$20::jsonb,$21,$21)
     RETURNING *`,
    [
      context.organizationId,
      source.company_id,
      source.branch_id,
      blueprint.code,
      blueprint.pipelineId,
      blueprint.stageId,
      blueprint.partyId,
      blueprint.contactId,
      source.campaign_id,
      source.source_id,
      blueprint.ownerUserId,
      blueprint.name,
      blueprint.description,
      blueprint.amount,
      blueprint.currencyCode,
      blueprint.probability,
      blueprint.expectedCloseDate,
      blueprint.forecastCategory,
      blueprint.nextStep,
      JSON.stringify(blueprint.customData),
      context.userId,
    ],
  );
  const cloneId = clone.rows[0].id;
  if (input.copyItems !== false) {
    await client.query(
      `INSERT INTO tenant.crm_opportunity_items
       (organization_id,opportunity_id,item_id,price_list_id,description,quantity,unit_price,discount_percent,tax_percent,created_by,updated_by)
       SELECT organization_id,$3,item_id,price_list_id,description,quantity,unit_price,discount_percent,tax_percent,$4,$4
         FROM tenant.crm_opportunity_items WHERE organization_id=$1 AND opportunity_id=$2`,
      [context.organizationId, sourceOpportunityId, cloneId, context.userId],
    );
  }
  await client.query(
    `INSERT INTO tenant.crm_opportunity_clone_events
     (organization_id,source_opportunity_id,cloned_opportunity_id,options,evidence_hash,created_by)
     VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
    [
      context.organizationId,
      sourceOpportunityId,
      cloneId,
      JSON.stringify(input),
      crmOpportunityRevenueHash({ sourceOpportunityId, cloneId, input }),
      context.userId,
    ],
  );
  return clone.rows[0];
}

export async function submitWinLossReview(client, context, input = {}) {
  const opportunity = await requireOpportunity(
    client,
    context,
    text(input.opportunityId),
  );
  if (!["won", "lost"].includes(text(opportunity.status))) {
    throw new CrmOpportunityRevenueError(
      409,
      "Win/loss reviews require a won or lost opportunity.",
      "CRM_WIN_LOSS_OUTCOME_REQUIRED",
    );
  }
  const result = await client.query(
    `INSERT INTO tenant.crm_win_loss_reviews
     (organization_id,opportunity_id,outcome,primary_reason,competitor_name,sales_cycle_days,interview_notes,lessons,reviewed_by,reviewed_at,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,now(),$9,$9)
     ON CONFLICT(organization_id,opportunity_id)
     DO UPDATE SET outcome=EXCLUDED.outcome,primary_reason=EXCLUDED.primary_reason,competitor_name=EXCLUDED.competitor_name,sales_cycle_days=EXCLUDED.sales_cycle_days,interview_notes=EXCLUDED.interview_notes,lessons=EXCLUDED.lessons,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now(),updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      opportunity.id,
      text(opportunity.status),
      text(input.primaryReason || "Unspecified"),
      text(input.competitorName) || null,
      Math.max(0, Math.trunc(number(input.salesCycleDays))),
      text(input.interviewNotes) || null,
      JSON.stringify(array(input.lessons)),
      context.userId,
    ],
  );
  return result.rows[0];
}

// Deliberately org-wide, not recordScope()-filtered — same rationale as
// F010's capturePipelineSnapshots (opportunity-and-pipeline-governance/
// pipeline-snapshots.js): a predictive forecast snapshot is a system-of-record
// artifact (crm_predictive_forecast_snapshots has no company_id column by
// design), not one caller's restricted view, so a company-scoped manager
// triggering a capture must not thereby produce an incomplete/misleading
// org-level prediction. The access boundary is the capture action's own
// permission gate (crmOpportunitiesManage, enforced by the calling route),
// consistent with F010's manual-capture gate using the same permission.
export async function capturePredictiveForecast(client, context, input = {}) {
  const opportunityResult = await client.query(
    `SELECT id,amount,probability,expected_close_date,status,last_activity_at,created_at,updated_at,
            GREATEST(0,EXTRACT(day FROM now()-COALESCE(last_activity_at,updated_at,created_at)))::int AS age_days,
            CASE WHEN expected_close_date IS NOT NULL AND expected_close_date<current_date THEN true ELSE false END AS close_overdue,
            CASE WHEN next_step IS NULL OR btrim(next_step)='' THEN 45 ELSE 75 END AS health_score
       FROM tenant.crm_opportunities
      WHERE organization_id=$1 AND status='open'`,
    [context.organizationId],
  );
  const historical = await client.query(
    `SELECT COALESCE(count(*) FILTER(WHERE status='won')::numeric/NULLIF(count(*) FILTER(WHERE status IN('won','lost')),0),0.35) AS win_rate
       FROM tenant.crm_opportunities WHERE organization_id=$1`,
    [context.organizationId],
  );
  const forecast = calculatePredictiveForecast({
    opportunities: opportunityResult.rows,
    historicalWinRate: historical.rows[0]?.win_rate,
  });
  const result = await client.query(
    `INSERT INTO tenant.crm_predictive_forecast_snapshots
     (organization_id,forecast_period_id,model_version,pipeline_amount,predicted_amount,confidence_percent,explanation,content_hash,captured_by)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
    [
      context.organizationId,
      input.forecastPeriodId || null,
      forecast.modelVersion,
      forecast.pipelineAmount,
      forecast.predictedAmount,
      forecast.confidence,
      JSON.stringify(forecast),
      crmOpportunityRevenueHash(forecast),
      context.userId,
    ],
  );
  return { snapshot: result.rows[0], forecast };
}

export async function saveQuotaSeasonality(client, context, input = {}) {
  const quotaPlanId = text(input.quotaPlanId);
  const quota = await client.query(
    `SELECT * FROM tenant.crm_quota_plans WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, quotaPlanId],
  );
  if (!quota.rows[0])
    throw new CrmOpportunityRevenueError(
      404,
      "Quota plan not found.",
      "CRM_QUOTA_NOT_FOUND",
    );
  if (text(quota.rows[0].status) === "closed")
    throw new CrmOpportunityRevenueError(
      409,
      "Closed quota plans cannot be reallocated.",
      "CRM_QUOTA_CLOSED",
    );
  const allocation = allocateQuotaSeasonality({
    totalAmount: quota.rows[0].target_amount,
    weights: input.weights,
  });
  await client.query(
    `DELETE FROM tenant.crm_quota_seasonality_allocations WHERE organization_id=$1 AND quota_plan_id=$2`,
    [context.organizationId, quotaPlanId],
  );
  for (const row of allocation) {
    await client.query(
      `INSERT INTO tenant.crm_quota_seasonality_allocations
       (organization_id,quota_plan_id,period_key,weight,target_amount,status,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,'draft',$6,$6)`,
      [
        context.organizationId,
        quotaPlanId,
        row.periodKey,
        row.weight,
        row.targetAmount,
        context.userId,
      ],
    );
  }
  return {
    quotaPlanId,
    allocation,
    total: round2(allocation.reduce((sum, row) => sum + row.targetAmount, 0)),
  };
}

export async function getOpportunityRevenueWorkspace(
  client,
  context,
  opportunityId,
) {
  const opportunity = await requireOpportunity(client, context, opportunityId);
  // Sequential, not Promise.all — see getOpportunityRevenueDashboard below
  // for why concurrent client.query() on one shared PoolClient is unsafe.
  const items = await client.query(
    `SELECT oi.*,COALESCE(jsonb_agg(jsonb_build_object('sequence',rs.sequence,'scheduleDate',rs.schedule_date,'amount',rs.amount,'interval',rs.recurrence_interval) ORDER BY rs.sequence) FILTER(WHERE rs.id IS NOT NULL),'[]'::jsonb) AS revenue_schedule
       FROM tenant.crm_opportunity_items oi
       LEFT JOIN tenant.crm_opportunity_revenue_schedules rs ON rs.organization_id=oi.organization_id AND rs.opportunity_item_id=oi.id
      WHERE oi.organization_id=$1 AND oi.opportunity_id=$2 GROUP BY oi.id ORDER BY oi.created_at`,
    [context.organizationId, opportunityId],
  );
  const team = await client.query(
    `SELECT tm.id,tm.user_id,tm.team_role,tm.access_level,u.full_name,
            COALESCE(jsonb_agg(jsonb_build_object('splitType',s.split_type,'percent',s.split_percent)) FILTER(WHERE s.id IS NOT NULL),'[]'::jsonb) AS splits
       FROM tenant.crm_opportunity_team_members tm
       JOIN public.users u ON u.id=tm.user_id
       LEFT JOIN tenant.crm_opportunity_revenue_splits s ON s.organization_id=tm.organization_id AND s.team_member_id=tm.id
      WHERE tm.organization_id=$1 AND tm.opportunity_id=$2 GROUP BY tm.id,u.full_name ORDER BY u.full_name`,
    [context.organizationId, opportunityId],
  );
  const plan = await client.query(
    `SELECT p.*,COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'sequence',m.sequence,'dueDate',m.due_date,'required',m.required,'status',m.status,'internalOwnerUserId',m.internal_owner_user_id,'customerOwnerName',m.customer_owner_name) ORDER BY m.sequence) FILTER(WHERE m.id IS NOT NULL),'[]'::jsonb) AS milestones
       FROM tenant.crm_mutual_action_plans p
       LEFT JOIN tenant.crm_mutual_action_plan_milestones m ON m.organization_id=p.organization_id AND m.plan_id=p.id
      WHERE p.organization_id=$1 AND p.opportunity_id=$2 GROUP BY p.id`,
    [context.organizationId, opportunityId],
  );
  const reviews = await client.query(
    `SELECT * FROM tenant.crm_win_loss_reviews WHERE organization_id=$1 AND opportunity_id=$2`,
    [context.organizationId, opportunityId],
  );
  const forecasts = await client.query(
    `SELECT * FROM tenant.crm_predictive_forecast_snapshots WHERE organization_id=$1 ORDER BY captured_at DESC LIMIT 10`,
    [context.organizationId],
  );
  const actionPlan = plan.rows[0] || null;
  return {
    opportunity,
    items: items.rows,
    team: team.rows,
    actionPlan,
    actionPlanEvaluation: actionPlan
      ? evaluateMutualActionPlan({ milestones: actionPlan.milestones })
      : null,
    winLossReview: reviews.rows[0] || null,
    forecasts: forecasts.rows,
  };
}

export async function getOpportunityRevenueDashboard(client, context) {
  const summaryParameters = [context.organizationId];
  const winLossParameters = [context.organizationId];
  const quotaParameters = [context.organizationId];
  const actionPlanParameters = [context.organizationId];
  // Integrity closeout (Prompts 1-5): only the summary query below applied
  // recordScope() — win/loss reviews, quota plans/allocations and action
  // plans were queried by organization_id alone, so a company-restricted
  // caller saw every company's loss reasons, competitor names, quota
  // targets and action-plan status in this "dashboard," not just their own
  // scope, even though the summary query right above it was correctly
  // scoped. Each is now scoped through its real anchor: win/loss reviews
  // and action plans via their parent Opportunity's own recordScope
  // (mirroring the summary query exactly); quota plans/allocations via
  // crm_quota_plans.company_id directly. crm_predictive_forecast_snapshots
  // has no company_id and no opportunity_id in its schema — it is a
  // genuine organization-level forecasting artifact, not a per-company or
  // per-opportunity one, so it stays organization-scoped intentionally.
  const winLossOpportunityScope = recordScope(
    resources.opportunities,
    context,
    winLossParameters,
    "opportunity",
  );
  const actionPlanOpportunityScope = recordScope(
    resources.opportunities,
    context,
    actionPlanParameters,
    "opportunity",
  );
  let quotaCompanyScope = "";
  if (!context.allowAllCompanies) {
    if (!context.activeCompanyId) {
      quotaCompanyScope = " AND false";
    } else {
      quotaParameters.push(context.activeCompanyId);
      quotaCompanyScope = ` AND (q.company_id IS NULL OR q.company_id = $${quotaParameters.length})`;
    }
  }
  // Sequential, not Promise.all: these 5 reads share one PoolClient with
  // dynamic, differing parameter counts (recordScope()/quotaCompanyScope
  // append scope params conditionally) — firing them concurrently on a
  // single client risks the extended-query protocol interleaving Parse/Bind
  // across queries (observed live as "bind message supplies N parameters,
  // but prepared statement "" requires M", Postgres error 08P01). node-pg
  // itself deprecated concurrent client.query() for exactly this reason.
  const summary = await client.query(
    `SELECT count(*) FILTER(WHERE record.status='open')::int AS open_opportunities,
            COALESCE(sum(record.amount) FILTER(WHERE record.status='open'),0)::numeric AS open_pipeline,
            count(*) FILTER(WHERE record.status='won')::int AS won,
            count(*) FILTER(WHERE record.status='lost')::int AS lost,
            count(*) FILTER(WHERE record.status='open' AND record.expected_close_date<current_date)::int AS overdue
       FROM tenant.crm_opportunities record WHERE record.organization_id=$1${recordScope(resources.opportunities, context, summaryParameters)}`,
    summaryParameters,
  );
  const forecast = await client.query(
    `SELECT * FROM tenant.crm_predictive_forecast_snapshots WHERE organization_id=$1 ORDER BY captured_at DESC LIMIT 1`,
    [context.organizationId],
  );
  const winLoss = await client.query(
    `SELECT review.outcome,review.primary_reason,review.competitor_name,review.sales_cycle_days
       FROM tenant.crm_win_loss_reviews review
       JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id=review.organization_id AND opportunity.id=review.opportunity_id
      WHERE review.organization_id=$1${winLossOpportunityScope}
      ORDER BY review.reviewed_at DESC LIMIT 200`,
    winLossParameters,
  );
  const quota = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.crm_quota_plans q WHERE q.organization_id=$1${quotaCompanyScope}) AS plans,
       (SELECT COALESCE(sum(q.target_amount),0)::numeric FROM tenant.crm_quota_plans q WHERE q.organization_id=$1${quotaCompanyScope}) AS target,
       (SELECT COALESCE(sum(a.target_amount),0)::numeric FROM tenant.crm_quota_seasonality_allocations a JOIN tenant.crm_quota_plans q ON q.organization_id=a.organization_id AND q.id=a.quota_plan_id WHERE a.organization_id=$1${quotaCompanyScope}) AS allocated`,
    quotaParameters,
  );
  const actionPlans = await client.query(
    `SELECT p.id,p.opportunity_id,p.name,p.status,p.target_close_date,count(m.id)::int AS milestones,count(m.id) FILTER(WHERE m.status='completed')::int AS completed
       FROM tenant.crm_mutual_action_plans p
       JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id=p.organization_id AND opportunity.id=p.opportunity_id
       LEFT JOIN tenant.crm_mutual_action_plan_milestones m ON m.organization_id=p.organization_id AND m.plan_id=p.id
      WHERE p.organization_id=$1${actionPlanOpportunityScope}
      GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 20`,
    actionPlanParameters,
  );
  return {
    summary: summary.rows[0],
    latestForecast: forecast.rows[0] || null,
    winLoss: summarizeWinLoss(winLoss.rows),
    quota: quota.rows[0],
    actionPlans: actionPlans.rows,
  };
}

// F011 integrity closeout (Prompts 1-5): the predictive-forecast model
// already exposed model version/confidence/predicted amount (real
// provenance, closed this prompt via the /crm/forecast page), but the
// dossier's separate drift/calibration-monitoring requirement was
// unimplemented — no comparison of a past prediction against what actually
// closed existed anywhere. This is a deterministic comparison of stored
// predictions (crm_predictive_forecast_snapshots, scoped to a real closed
// forecast period) against the actual won revenue for that same period —
// not a fabricated AI output, and it never reinterprets history: each
// snapshot's own model_version/predicted_amount stays exactly as captured.
export async function getForecastCalibration(client, context, limit = 6) {
  const boundedLimit = Math.max(1, Math.min(24, Math.trunc(Number(limit) || 6)));
  const parameters = [context.organizationId, boundedLimit];
  const result = await client.query(
    `SELECT period.id AS period_id, period.name AS period_name,
            period.period_start, period.period_end,
            snapshot.model_version, snapshot.predicted_amount, snapshot.confidence_percent,
            snapshot.captured_at,
            COALESCE((
              SELECT sum(opportunity.amount)::numeric
                FROM tenant.crm_opportunities opportunity
               WHERE opportunity.organization_id = period.organization_id
                 AND opportunity.status = 'won'
                 AND opportunity.actual_close_date BETWEEN period.period_start AND period.period_end
            ), 0)::numeric AS actual_won_amount
       FROM tenant.crm_forecast_periods period
       JOIN LATERAL (
         SELECT s.model_version, s.predicted_amount, s.confidence_percent, s.captured_at
           FROM tenant.crm_predictive_forecast_snapshots s
          WHERE s.organization_id = period.organization_id
            AND s.forecast_period_id = period.id
          ORDER BY s.captured_at DESC
          LIMIT 1
       ) snapshot ON true
      WHERE period.organization_id = $1 AND period.status = 'closed'
      ORDER BY period.period_end DESC
      LIMIT $2`,
    parameters,
  );
  return result.rows.map((row) => {
    const predicted = Number(row.predicted_amount || 0);
    const actual = Number(row.actual_won_amount || 0);
    const errorAmount = actual - predicted;
    const errorPercent = predicted > 0 ? Math.round((errorAmount / predicted) * 10000) / 100 : null;
    return {
      periodId: row.period_id,
      periodName: row.period_name,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      modelVersion: row.model_version,
      confidencePercent: Number(row.confidence_percent || 0),
      predictedAmount: predicted,
      actualWonAmount: actual,
      errorAmount,
      errorPercent,
      capturedAt: row.captured_at,
    };
  });
}

export async function recordCrmOpportunityRevenueAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId);
  if (!CRM_OPPORTUNITY_REVENUE_CAPABILITY_IDS.includes(capabilityId)) {
    throw new CrmOpportunityRevenueError(
      400,
      "Unknown CRM-09 capability.",
      "CRM_09_CAPABILITY_UNKNOWN",
    );
  }
  const evidence = object(input.evidence);
  const commitSha = text(input.commitSha || "crm-09-local");
  const result = await client.query(
    `INSERT INTO tenant.crm_opportunity_revenue_acceptance_evidence
     (organization_id,capability_id,commit_sha,status,evidence,evidence_hash,verified_by,verified_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,now())
     ON CONFLICT(organization_id,capability_id,commit_sha) DO NOTHING
     RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      commitSha,
      text(input.status || "passed"),
      JSON.stringify(evidence),
      crmOpportunityRevenueHash(evidence),
      context.userId,
    ],
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await client.query(
    `SELECT * FROM tenant.crm_opportunity_revenue_acceptance_evidence
      WHERE organization_id=$1 AND capability_id=$2 AND commit_sha=$3`,
    [context.organizationId, capabilityId, commitSha],
  );
  return existing.rows[0];
}

export async function getCrmOpportunityRevenueReadiness(
  client,
  context,
  commitSha = null,
) {
  const values = [context.organizationId];
  let condition = "";
  if (commitSha) {
    values.push(commitSha);
    condition = ` AND commit_sha=$${values.length}`;
  }
  const result = await client.query(
    `SELECT capability_id,status,verified_at,evidence_hash FROM tenant.crm_opportunity_revenue_acceptance_evidence WHERE organization_id=$1${condition}`,
    values,
  );
  const passed = new Set(
    result.rows
      .filter((row) => row.status === "passed")
      .map((row) => row.capability_id),
  );
  const missing = CRM_OPPORTUNITY_REVENUE_CAPABILITY_IDS.filter(
    (id) => !passed.has(id),
  );
  return {
    readiness: missing.length ? "blocked" : "ready",
    total: CRM_OPPORTUNITY_REVENUE_CAPABILITY_IDS.length,
    passed: passed.size,
    missing,
    evidence: result.rows,
  };
}
