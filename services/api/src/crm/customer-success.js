import { createHash } from "node:crypto";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS = Object.freeze([
  "CRM-031",
  "CRM-032",
  "CRM-033",
  "CRM-034",
  "CRM-047",
]);

export class CrmCustomerSuccessError extends Error {
  constructor(status, message, code = "CRM_CUSTOMER_SUCCESS_ERROR") {
    super(message);
    this.name = "CrmCustomerSuccessError";
    this.status = status;
    this.code = code;
  }
}

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);
const number = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

function assertId(value, label) {
  const result = text(value);
  if (!UUID.test(result))
    throw new CrmCustomerSuccessError(
      400,
      `${label} is invalid.`,
      "CRM_IDENTIFIER_INVALID",
    );
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function crmCustomerSuccessHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function normalizeCustomerFeedbackScore(surveyType, rawScore) {
  const type = text(surveyType).toLowerCase();
  const score = number(rawScore, Number.NaN);
  if (type === "nps") {
    if (!Number.isFinite(score) || score < 0 || score > 10)
      throw new CrmCustomerSuccessError(
        400,
        "NPS must be between 0 and 10.",
        "CRM_FEEDBACK_SCORE_INVALID",
      );
    return Math.round(score * 10 * 100) / 100;
  }
  if (type === "csat" || type === "ces") {
    if (!Number.isFinite(score) || score < 1 || score > 5)
      throw new CrmCustomerSuccessError(
        400,
        `${type.toUpperCase()} must be between 1 and 5.`,
        "CRM_FEEDBACK_SCORE_INVALID",
      );
    return Math.round(((score - 1) / 4) * 10000) / 100;
  }
  throw new CrmCustomerSuccessError(
    400,
    "Survey type must be nps, csat or ces.",
    "CRM_FEEDBACK_TYPE_INVALID",
  );
}

export function customerSuccessHealthFromSignals(input = {}) {
  const milestoneCompletion = Math.max(
    0,
    Math.min(100, number(input.milestoneCompletion, 0)),
  );
  const overdueMilestones = Math.max(0, number(input.overdueMilestones, 0));
  const usageScore = Math.max(0, Math.min(100, number(input.usageScore, 50)));
  const feedbackScore = Math.max(
    0,
    Math.min(100, number(input.feedbackScore, 50)),
  );
  const openServiceRisks = Math.max(0, number(input.openServiceRisks, 0));
  const openChurnInterventions = Math.max(
    0,
    number(input.openChurnInterventions, 0),
  );
  const renewalDays =
    input.renewalDays == null ? null : number(input.renewalDays, 0);

  let score =
    milestoneCompletion * 0.35 + usageScore * 0.3 + feedbackScore * 0.2 + 15;
  score -= Math.min(25, overdueMilestones * 6);
  score -= Math.min(20, openServiceRisks * 5);
  score -= Math.min(20, openChurnInterventions * 8);
  if (renewalDays != null && renewalDays <= 30) score -= 8;
  if (renewalDays != null && renewalDays < 0) score -= 15;
  score = Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
  const status =
    score >= 80
      ? "healthy"
      : score >= 60
        ? "watch"
        : score >= 40
          ? "at_risk"
          : "critical";
  const reasons = [];
  if (overdueMilestones)
    reasons.push(`${overdueMilestones} overdue milestone(s)`);
  if (usageScore < 50) reasons.push("Low recent product usage");
  if (feedbackScore < 50) reasons.push("Low customer feedback");
  if (openServiceRisks)
    reasons.push(`${openServiceRisks} unresolved service risk(s)`);
  if (openChurnInterventions)
    reasons.push(`${openChurnInterventions} open churn intervention(s)`);
  if (renewalDays != null && renewalDays <= 30)
    reasons.push("Renewal is due within 30 days");
  return { score, status, reasons };
}

async function assertAccount(client, context, partyId) {
  const id = assertId(partyId, "Account");
  const result = await client.query(
    `SELECT party.*,plan.id AS account_plan_id,plan.renewal_date,plan.annual_revenue,plan.health_score AS existing_health_score
     FROM tenant.business_parties party
     LEFT JOIN tenant.crm_account_plans plan ON plan.organization_id=party.organization_id AND plan.party_id=party.id
     WHERE party.organization_id=$1 AND party.id=$2 AND party.status='active'`,
    [context.organizationId, id],
  );
  if (!result.rows[0])
    throw new CrmCustomerSuccessError(
      404,
      "Customer account not found.",
      "CRM_CUSTOMER_ACCOUNT_NOT_FOUND",
    );
  return result.rows[0];
}

async function template(client, context, templateId) {
  const result = templateId
    ? await client.query(
        `SELECT * FROM tenant.crm_success_plan_templates WHERE organization_id=$1 AND id=$2 AND status='active'`,
        [context.organizationId, assertId(templateId, "Success plan template")],
      )
    : await client.query(
        `SELECT * FROM tenant.crm_success_plan_templates WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
        [context.organizationId],
      );
  if (!result.rows[0])
    throw new CrmCustomerSuccessError(
      409,
      "No active customer-success template is configured.",
      "CRM_SUCCESS_TEMPLATE_MISSING",
    );
  return result.rows[0];
}

export async function createCustomerSuccessPlan(
  client,
  context,
  partyId,
  input = {},
) {
  const account = await assertAccount(client, context, partyId);
  const existing = await client.query(
    `SELECT * FROM tenant.crm_customer_success_plans WHERE organization_id=$1 AND party_id=$2 AND status IN ('draft','active','paused') ORDER BY created_at DESC LIMIT 1`,
    [context.organizationId, account.id],
  );
  if (existing.rows[0]) return existing.rows[0];
  const selectedTemplate = await template(client, context, input.templateId);
  const startDate =
    text(input.startDate) || new Date().toISOString().slice(0, 10);
  const targetDate = text(input.targetDate) || null;
  const accountPlan = await client.query(
    `INSERT INTO tenant.crm_account_plans(organization_id,company_id,party_id,owner_user_id,lifecycle_stage,success_plan,renewal_date,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,'onboarding',$5,$6,'active',$4,$4)
     ON CONFLICT (organization_id,party_id) DO UPDATE SET lifecycle_stage='onboarding',success_plan=EXCLUDED.success_plan,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      input.companyId || account.company_id || context.activeCompanyId || null,
      account.id,
      input.ownerUserId || context.userId,
      JSON.stringify({
        templateId: selectedTemplate.id,
        objectives: array(input.objectives),
      }),
      input.renewalDate || account.renewal_date || null,
    ],
  );
  const plan = await client.query(
    `INSERT INTO tenant.crm_customer_success_plans(
       organization_id,company_id,party_id,account_plan_id,template_id,owner_user_id,name,objectives,customer_participants,start_date,target_date,status,created_by,updated_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::date,$10::date+$12::int),'active',$6,$6) RETURNING *`,
    [
      context.organizationId,
      input.companyId || account.company_id || context.activeCompanyId || null,
      account.id,
      accountPlan.rows[0].id,
      selectedTemplate.id,
      input.ownerUserId || context.userId,
      text(input.name) || `${account.display_name} onboarding`,
      JSON.stringify(array(input.objectives)),
      JSON.stringify(array(input.customerParticipants)),
      startDate,
      targetDate,
      selectedTemplate.default_duration_days,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_customer_success_milestones(
       organization_id,plan_id,template_milestone_id,milestone_key,title,description,sequence,owner_user_id,due_date,health_weight,dependency_keys,customer_visible,created_by,updated_by
     )
     SELECT milestone.organization_id,$1,milestone.id,milestone.milestone_key,milestone.title,milestone.description,milestone.sequence,$2,$3::date+milestone.default_due_offset_days,milestone.health_weight,milestone.dependency_keys,milestone.customer_visible,$2,$2
     FROM tenant.crm_success_plan_template_milestones milestone
     WHERE milestone.organization_id=$4 AND milestone.template_id=$5
     ORDER BY milestone.sequence`,
    [
      plan.rows[0].id,
      input.ownerUserId || context.userId,
      startDate,
      context.organizationId,
      selectedTemplate.id,
    ],
  );
  await recalculateCustomerHealth(client, context, account.id);
  return plan.rows[0];
}

export async function updateCustomerSuccessMilestone(
  client,
  context,
  milestoneId,
  input = {},
) {
  const id = assertId(milestoneId, "Milestone");
  const current = await client.query(
    `SELECT milestone.*,plan.party_id FROM tenant.crm_customer_success_milestones milestone
     JOIN tenant.crm_customer_success_plans plan ON plan.organization_id=milestone.organization_id AND plan.id=milestone.plan_id
     WHERE milestone.organization_id=$1 AND milestone.id=$2 FOR UPDATE`,
    [context.organizationId, id],
  );
  const milestone = current.rows[0];
  if (!milestone)
    throw new CrmCustomerSuccessError(
      404,
      "Customer-success milestone not found.",
      "CRM_SUCCESS_MILESTONE_NOT_FOUND",
    );
  const nextStatus = text(input.status) || milestone.status;
  const allowed = new Set([
    "not_started",
    "in_progress",
    "blocked",
    "completed",
    "skipped",
    "cancelled",
  ]);
  if (!allowed.has(nextStatus))
    throw new CrmCustomerSuccessError(
      400,
      "Milestone status is invalid.",
      "CRM_SUCCESS_MILESTONE_STATUS_INVALID",
    );
  if (nextStatus === "completed") {
    const dependencies = array(milestone.dependency_keys);
    if (dependencies.length) {
      const result = await client.query(
        `SELECT milestone_key,status FROM tenant.crm_customer_success_milestones WHERE organization_id=$1 AND plan_id=$2 AND milestone_key=ANY($3::text[])`,
        [context.organizationId, milestone.plan_id, dependencies],
      );
      const completed = new Set(
        result.rows
          .filter(
            (row) => row.status === "completed" || row.status === "skipped",
          )
          .map((row) => row.milestone_key),
      );
      const missing = dependencies.filter((key) => !completed.has(key));
      if (missing.length)
        throw new CrmCustomerSuccessError(
          409,
          `Complete prerequisite milestone(s): ${missing.join(", ")}.`,
          "CRM_SUCCESS_MILESTONE_DEPENDENCY_BLOCKED",
        );
    }
  }
  const updated = await client.query(
    `UPDATE tenant.crm_customer_success_milestones SET status=$1,blocker_reason=$2,completion_notes=$3,owner_user_id=COALESCE($4,owner_user_id),due_date=COALESCE($5::date,due_date),completed_at=CASE WHEN $1='completed' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_by=$6,updated_at=now() WHERE organization_id=$7 AND id=$8 RETURNING *`,
    [
      nextStatus,
      text(input.blockerReason) || null,
      text(input.completionNotes) || null,
      input.ownerUserId || null,
      input.dueDate || null,
      context.userId,
      context.organizationId,
      id,
    ],
  );
  await recalculateCustomerHealth(client, context, milestone.party_id);
  return updated.rows[0];
}

export async function ingestProductUsageEvent(client, context, input = {}) {
  const partyId = assertId(input.partyId, "Account");
  await assertAccount(client, context, partyId);
  const externalSystem = text(input.externalSystem);
  const externalEventId = text(input.externalEventId);
  const metricName = text(input.metricName);
  if (!externalSystem || !externalEventId || !metricName)
    throw new CrmCustomerSuccessError(
      400,
      "External system, event ID and metric name are required.",
      "CRM_USAGE_EVENT_REQUIRED",
    );
  const metricValue = number(input.metricValue, Number.NaN);
  if (!Number.isFinite(metricValue))
    throw new CrmCustomerSuccessError(
      400,
      "Metric value must be numeric.",
      "CRM_USAGE_VALUE_INVALID",
    );
  const result = await client.query(
    `INSERT INTO tenant.crm_product_usage_events(organization_id,company_id,party_id,external_system,external_event_id,metric_name,metric_value,metric_unit,occurred_at,dimensions,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,now()),$10,$11)
     ON CONFLICT (organization_id,external_system,external_event_id) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId || null,
      partyId,
      externalSystem,
      externalEventId,
      metricName,
      metricValue,
      text(input.metricUnit) || null,
      input.occurredAt || null,
      JSON.stringify(object(input.dimensions)),
      context.userId,
    ],
  );
  const event =
    result.rows[0] ||
    (
      await client.query(
        `SELECT * FROM tenant.crm_product_usage_events WHERE organization_id=$1 AND external_system=$2 AND external_event_id=$3`,
        [context.organizationId, externalSystem, externalEventId],
      )
    ).rows[0];
  await recalculateCustomerHealth(client, context, partyId);
  return { ...event, duplicate: !result.rows[0] };
}

export async function recordCustomerFeedback(client, context, input = {}) {
  const partyId = assertId(input.partyId, "Account");
  await assertAccount(client, context, partyId);
  const surveyType = text(input.surveyType).toLowerCase();
  const normalizedScore = normalizeCustomerFeedbackScore(
    surveyType,
    input.score,
  );
  const rawScore = number(input.score);
  const followUpRequired = surveyType === "nps" ? rawScore <= 6 : rawScore <= 2;
  const result = await client.query(
    `INSERT INTO tenant.crm_customer_feedback_responses(organization_id,company_id,party_id,contact_id,survey_type,score,normalized_score,comment,channel,external_response_id,responded_at,follow_up_required,metadata,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,now()),$12,$13,$14)
     ON CONFLICT (organization_id,channel,external_response_id) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId || null,
      partyId,
      input.contactId || null,
      surveyType,
      rawScore,
      normalizedScore,
      text(input.comment) || null,
      text(input.channel) || "manual",
      text(input.externalResponseId) || null,
      input.respondedAt || null,
      followUpRequired,
      JSON.stringify(object(input.metadata)),
      context.userId,
    ],
  );
  const response = result.rows[0];
  if (!response && input.externalResponseId)
    return (
      await client.query(
        `SELECT * FROM tenant.crm_customer_feedback_responses WHERE organization_id=$1 AND channel=$2 AND external_response_id=$3`,
        [
          context.organizationId,
          text(input.channel) || "manual",
          text(input.externalResponseId),
        ],
      )
    ).rows[0];
  if (followUpRequired) {
    await createChurnIntervention(client, context, partyId, {
      triggerType: "feedback",
      severity: surveyType === "nps" && rawScore <= 3 ? "high" : "medium",
      title: `${surveyType.toUpperCase()} follow-up required`,
      actionPlan:
        "Contact the customer, understand the feedback and record an agreed recovery action.",
    });
  }
  await recalculateCustomerHealth(client, context, partyId);
  return response;
}

export async function upsertRenewalCase(client, context, partyId, input = {}) {
  const account = await assertAccount(client, context, partyId);
  const renewalDate = text(input.renewalDate) || account.renewal_date;
  if (!renewalDate)
    throw new CrmCustomerSuccessError(
      400,
      "Renewal date is required.",
      "CRM_RENEWAL_DATE_REQUIRED",
    );
  const plan = (
    await client.query(
      `SELECT id FROM tenant.crm_customer_success_plans WHERE organization_id=$1 AND party_id=$2 AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1`,
      [context.organizationId, account.id],
    )
  ).rows[0];
  const result = await client.query(
    `INSERT INTO tenant.crm_renewal_cases(organization_id,company_id,party_id,plan_id,opportunity_id,owner_user_id,renewal_date,contract_value,currency_code,probability,forecast_category,risk_level,expansion_value,next_action,next_action_at,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'open',$6,$6)
     ON CONFLICT (organization_id,party_id,renewal_date) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id,contract_value=EXCLUDED.contract_value,probability=EXCLUDED.probability,forecast_category=EXCLUDED.forecast_category,risk_level=EXCLUDED.risk_level,expansion_value=EXCLUDED.expansion_value,next_action=EXCLUDED.next_action,next_action_at=EXCLUDED.next_action_at,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      input.companyId || account.company_id || context.activeCompanyId || null,
      account.id,
      plan?.id || null,
      input.opportunityId || null,
      input.ownerUserId || context.userId,
      renewalDate,
      Math.max(0, number(input.contractValue, account.annual_revenue || 0)),
      text(input.currencyCode) || "INR",
      Math.max(0, Math.min(100, number(input.probability, 50))),
      text(input.forecastCategory) || "pipeline",
      text(input.riskLevel) || "medium",
      Math.max(0, number(input.expansionValue, 0)),
      text(input.nextAction) || null,
      input.nextActionAt || null,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_account_plans SET renewal_date=$1,lifecycle_stage='renewal',updated_by=$2,updated_at=now() WHERE organization_id=$3 AND party_id=$4`,
    [renewalDate, context.userId, context.organizationId, account.id],
  );
  await recalculateCustomerHealth(client, context, account.id);
  return result.rows[0];
}

export async function createChurnIntervention(
  client,
  context,
  partyId,
  input = {},
) {
  const account = await assertAccount(client, context, partyId);
  const triggerType = text(input.triggerType) || "manual";
  const allowedTriggers = new Set([
    "health",
    "usage",
    "feedback",
    "service",
    "renewal",
    "manual",
  ]);
  if (!allowedTriggers.has(triggerType))
    throw new CrmCustomerSuccessError(
      400,
      "Churn trigger is invalid.",
      "CRM_CHURN_TRIGGER_INVALID",
    );
  const title = text(input.title);
  const actionPlan = text(input.actionPlan);
  if (!title || !actionPlan)
    throw new CrmCustomerSuccessError(
      400,
      "Intervention title and action plan are required.",
      "CRM_CHURN_INTERVENTION_REQUIRED",
    );
  const plan = (
    await client.query(
      `SELECT id FROM tenant.crm_customer_success_plans WHERE organization_id=$1 AND party_id=$2 AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1`,
      [context.organizationId, account.id],
    )
  ).rows[0];
  const renewal = (
    await client.query(
      `SELECT id FROM tenant.crm_renewal_cases WHERE organization_id=$1 AND party_id=$2 AND status IN ('open','negotiating') ORDER BY renewal_date LIMIT 1`,
      [context.organizationId, account.id],
    )
  ).rows[0];
  return (
    await client.query(
      `INSERT INTO tenant.crm_churn_interventions(organization_id,company_id,party_id,plan_id,renewal_case_id,trigger_type,severity,title,action_plan,owner_user_id,due_at,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$10,$10) RETURNING *`,
      [
        context.organizationId,
        input.companyId ||
          account.company_id ||
          context.activeCompanyId ||
          null,
        account.id,
        plan?.id || null,
        renewal?.id || null,
        triggerType,
        text(input.severity) || "medium",
        title,
        actionPlan,
        input.ownerUserId || context.userId,
        input.dueAt || null,
      ],
    )
  ).rows[0];
}

export async function resolveChurnIntervention(
  client,
  context,
  interventionId,
  resolution,
) {
  const id = assertId(interventionId, "Churn intervention");
  const note = text(resolution);
  if (!note)
    throw new CrmCustomerSuccessError(
      400,
      "Resolution is required.",
      "CRM_CHURN_RESOLUTION_REQUIRED",
    );
  const result = await client.query(
    `UPDATE tenant.crm_churn_interventions SET status='resolved',resolution=$1,resolved_at=now(),updated_by=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 AND status IN ('open','in_progress') RETURNING *`,
    [note, context.userId, context.organizationId, id],
  );
  if (!result.rows[0])
    throw new CrmCustomerSuccessError(
      404,
      "Open churn intervention not found.",
      "CRM_CHURN_INTERVENTION_NOT_FOUND",
    );
  await recalculateCustomerHealth(client, context, result.rows[0].party_id);
  return result.rows[0];
}

export async function recalculateCustomerHealth(client, context, partyId) {
  const account = await assertAccount(client, context, partyId);
  const plan =
    (
      await client.query(
        `SELECT * FROM tenant.crm_customer_success_plans WHERE organization_id=$1 AND party_id=$2 AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1`,
        [context.organizationId, account.id],
      )
    ).rows[0] || null;
  const milestone = plan
    ? (
        await client.query(
          `SELECT COALESCE(sum(health_weight) FILTER (WHERE status IN ('completed','skipped')),0)::numeric AS completed_weight,
            COALESCE(sum(health_weight),0)::numeric AS total_weight,
            count(*) FILTER (WHERE status NOT IN ('completed','skipped','cancelled') AND due_date<current_date)::int AS overdue
     FROM tenant.crm_customer_success_milestones WHERE organization_id=$1 AND plan_id=$2`,
          [context.organizationId, plan.id],
        )
      ).rows[0]
    : { completed_weight: 0, total_weight: 0, overdue: 0 };
  const usage = (
    await client.query(
      `SELECT COALESCE(sum(metric_value) FILTER (WHERE occurred_at>=now()-interval '30 days'),0)::numeric AS recent,
            COALESCE(sum(metric_value) FILTER (WHERE occurred_at<now()-interval '30 days' AND occurred_at>=now()-interval '60 days'),0)::numeric AS previous
     FROM tenant.crm_product_usage_events WHERE organization_id=$1 AND party_id=$2`,
      [context.organizationId, account.id],
    )
  ).rows[0];
  const feedback = (
    await client.query(
      `SELECT avg(normalized_score)::numeric AS score FROM tenant.crm_customer_feedback_responses WHERE organization_id=$1 AND party_id=$2 AND responded_at>=now()-interval '180 days'`,
      [context.organizationId, account.id],
    )
  ).rows[0];
  const serviceRisks = number(
    (
      await client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_customer_service_events WHERE organization_id=$1 AND party_id=$2 AND status IN ('open','pending') AND priority IN ('high','urgent')`,
        [context.organizationId, account.id],
      )
    ).rows[0]?.count,
  );
  const churnRisks = number(
    (
      await client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_churn_interventions WHERE organization_id=$1 AND party_id=$2 AND status IN ('open','in_progress')`,
        [context.organizationId, account.id],
      )
    ).rows[0]?.count,
  );
  const renewal = (
    await client.query(
      `SELECT renewal_date FROM tenant.crm_renewal_cases WHERE organization_id=$1 AND party_id=$2 AND status IN ('open','negotiating') ORDER BY renewal_date LIMIT 1`,
      [context.organizationId, account.id],
    )
  ).rows[0];
  const completedWeight = number(milestone.completed_weight);
  const totalWeight = number(milestone.total_weight);
  const milestoneCompletion =
    totalWeight > 0 ? (completedWeight / totalWeight) * 100 : 50;
  const recent = number(usage.recent);
  const previous = number(usage.previous);
  const usageScore =
    recent <= 0
      ? 25
      : previous <= 0
        ? 70
        : Math.max(
            0,
            Math.min(
              100,
              50 + ((recent - previous) / Math.max(previous, 1)) * 50,
            ),
          );
  const feedbackScore =
    feedback.score == null ? 50 : number(feedback.score, 50);
  const renewalDays = renewal?.renewal_date
    ? Math.ceil(
        (new Date(renewal.renewal_date).getTime() - Date.now()) / 86400000,
      )
    : null;
  const health = customerSuccessHealthFromSignals({
    milestoneCompletion,
    overdueMilestones: milestone.overdue,
    usageScore,
    feedbackScore,
    openServiceRisks: serviceRisks,
    openChurnInterventions: churnRisks,
    renewalDays,
  });
  const components = {
    milestoneCompletion: Math.round(milestoneCompletion * 100) / 100,
    overdueMilestones: number(milestone.overdue),
    usageScore: Math.round(usageScore * 100) / 100,
    feedbackScore: Math.round(feedbackScore * 100) / 100,
    openServiceRisks: serviceRisks,
    openChurnInterventions: churnRisks,
    renewalDays,
  };
  const snapshot = {
    partyId: account.id,
    planId: plan?.id || null,
    healthScore: health.score,
    healthStatus: health.status,
    components,
    reasons: health.reasons,
    calculationVersion: "crm03-v1",
  };
  const contentHash = crmCustomerSuccessHash(snapshot);
  await client.query(
    `INSERT INTO tenant.crm_customer_health_snapshots(organization_id,company_id,party_id,plan_id,health_score,health_status,components,reasons,calculation_version,content_hash,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'crm03-v1',$9,$10)`,
    [
      context.organizationId,
      account.company_id || context.activeCompanyId || null,
      account.id,
      plan?.id || null,
      health.score,
      health.status,
      JSON.stringify(components),
      JSON.stringify(health.reasons),
      contentHash,
      context.userId,
    ],
  );
  if (plan)
    await client.query(
      `UPDATE tenant.crm_customer_success_plans SET health_score=$1,health_status=$2,updated_by=$3,updated_at=now() WHERE organization_id=$4 AND id=$5`,
      [
        health.score,
        health.status,
        context.userId,
        context.organizationId,
        plan.id,
      ],
    );
  await client.query(
    `UPDATE tenant.crm_account_plans SET health_score=$1,health_status=$2,lifecycle_stage=CASE WHEN $2 IN ('at_risk','critical') THEN 'at_risk' ELSE lifecycle_stage END,updated_by=$3,updated_at=now() WHERE organization_id=$4 AND party_id=$5`,
    [
      health.score,
      health.status,
      context.userId,
      context.organizationId,
      account.id,
    ],
  );
  if (health.status === "critical") {
    const open = await client.query(
      `SELECT 1 FROM tenant.crm_churn_interventions WHERE organization_id=$1 AND party_id=$2 AND trigger_type='health' AND status IN ('open','in_progress') LIMIT 1`,
      [context.organizationId, account.id],
    );
    if (!open.rows[0])
      await createChurnIntervention(client, context, account.id, {
        triggerType: "health",
        severity: "critical",
        title: "Critical customer health",
        actionPlan:
          "Run an executive recovery review and agree measurable recovery actions within 48 hours.",
      });
  }
  return { ...snapshot, contentHash };
}

export async function getCustomerSuccessAccount(client, context, partyId) {
  const account = await assertAccount(client, context, partyId);
  const plan =
    (
      await client.query(
        `SELECT * FROM tenant.crm_customer_success_plans WHERE organization_id=$1 AND party_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [context.organizationId, account.id],
      )
    ).rows[0] || null;
  const [milestones, usage, feedback, renewals, interventions, health] =
    await Promise.all([
      plan
        ? client.query(
            `SELECT * FROM tenant.crm_customer_success_milestones WHERE organization_id=$1 AND plan_id=$2 ORDER BY sequence`,
            [context.organizationId, plan.id],
          )
        : { rows: [] },
      client.query(
        `SELECT * FROM tenant.crm_product_usage_events WHERE organization_id=$1 AND party_id=$2 ORDER BY occurred_at DESC LIMIT 100`,
        [context.organizationId, account.id],
      ),
      client.query(
        `SELECT * FROM tenant.crm_customer_feedback_responses WHERE organization_id=$1 AND party_id=$2 ORDER BY responded_at DESC LIMIT 100`,
        [context.organizationId, account.id],
      ),
      client.query(
        `SELECT * FROM tenant.crm_renewal_cases WHERE organization_id=$1 AND party_id=$2 ORDER BY renewal_date DESC LIMIT 20`,
        [context.organizationId, account.id],
      ),
      client.query(
        `SELECT * FROM tenant.crm_churn_interventions WHERE organization_id=$1 AND party_id=$2 ORDER BY created_at DESC LIMIT 50`,
        [context.organizationId, account.id],
      ),
      client.query(
        `SELECT * FROM tenant.crm_customer_health_snapshots WHERE organization_id=$1 AND party_id=$2 ORDER BY calculated_at DESC LIMIT 20`,
        [context.organizationId, account.id],
      ),
    ]);
  return {
    account,
    plan,
    milestones: milestones.rows,
    usage: usage.rows,
    feedback: feedback.rows,
    renewals: renewals.rows,
    interventions: interventions.rows,
    healthHistory: health.rows,
  };
}

export async function getCustomerSuccessDashboard(client, context) {
  const summary = (
    await client.query(
      `SELECT count(*) FILTER (WHERE status IN ('active','paused'))::int AS active_plans,
            count(*) FILTER (WHERE health_status='healthy')::int AS healthy,
            count(*) FILTER (WHERE health_status='watch')::int AS watch,
            count(*) FILTER (WHERE health_status='at_risk')::int AS at_risk,
            count(*) FILTER (WHERE health_status='critical')::int AS critical,
            round(avg(health_score),2) AS average_health
     FROM tenant.crm_customer_success_plans WHERE organization_id=$1`,
      [context.organizationId],
    )
  ).rows[0];
  const [renewals, interventions, milestones, feedback] = await Promise.all([
    client.query(
      `SELECT renewal.*,party.display_name FROM tenant.crm_renewal_cases renewal JOIN tenant.business_parties party ON party.organization_id=renewal.organization_id AND party.id=renewal.party_id WHERE renewal.organization_id=$1 AND renewal.status IN ('open','negotiating') ORDER BY renewal.renewal_date LIMIT 50`,
      [context.organizationId],
    ),
    client.query(
      `SELECT intervention.*,party.display_name FROM tenant.crm_churn_interventions intervention JOIN tenant.business_parties party ON party.organization_id=intervention.organization_id AND party.id=intervention.party_id WHERE intervention.organization_id=$1 AND intervention.status IN ('open','in_progress') ORDER BY CASE intervention.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,intervention.due_at NULLS LAST LIMIT 50`,
      [context.organizationId],
    ),
    client.query(
      `SELECT milestone.*,party.display_name FROM tenant.crm_customer_success_milestones milestone JOIN tenant.crm_customer_success_plans plan ON plan.organization_id=milestone.organization_id AND plan.id=milestone.plan_id JOIN tenant.business_parties party ON party.organization_id=plan.organization_id AND party.id=plan.party_id WHERE milestone.organization_id=$1 AND milestone.status NOT IN ('completed','skipped','cancelled') AND milestone.due_date<=current_date+14 ORDER BY milestone.due_date LIMIT 50`,
      [context.organizationId],
    ),
    client.query(
      `SELECT survey_type,count(*)::int AS responses,round(avg(normalized_score),2) AS average_score,count(*) FILTER (WHERE follow_up_required AND followed_up_at IS NULL)::int AS pending_follow_up FROM tenant.crm_customer_feedback_responses WHERE organization_id=$1 AND responded_at>=now()-interval '90 days' GROUP BY survey_type ORDER BY survey_type`,
      [context.organizationId],
    ),
  ]);
  return {
    summary,
    renewals: renewals.rows,
    interventions: interventions.rows,
    upcomingMilestones: milestones.rows,
    feedback: feedback.rows,
  };
}

export async function recordCrmCustomerSuccessAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId);
  if (!CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS.includes(capabilityId))
    throw new CrmCustomerSuccessError(
      400,
      "CRM-03 capability ID is invalid.",
      "CRM_CUSTOMER_SUCCESS_CAPABILITY_INVALID",
    );
  const status = text(input.status);
  if (!new Set(["passed", "failed"]).has(status))
    throw new CrmCustomerSuccessError(
      400,
      "Acceptance status must be passed or failed.",
      "CRM_CUSTOMER_SUCCESS_ACCEPTANCE_INVALID",
    );
  const evidence = object(input.evidence);
  const contentHash = crmCustomerSuccessHash({
    capabilityId,
    status,
    evidence,
    commitSha: text(input.commitSha) || null,
  });
  return (
    await client.query(
      `INSERT INTO tenant.crm_customer_success_acceptance_runs(organization_id,capability_id,status,evidence,content_hash,commit_sha,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        context.organizationId,
        capabilityId,
        status,
        JSON.stringify(evidence),
        contentHash,
        text(input.commitSha) || null,
        context.userId,
      ],
    )
  ).rows[0];
}

export async function getCrmCustomerSuccessReadiness(client, context) {
  const result = await client.query(
    `WITH latest AS (
       SELECT DISTINCT ON (capability_id) capability_id,status,evidence,content_hash,commit_sha,recorded_at
       FROM tenant.crm_customer_success_acceptance_runs WHERE organization_id=$1 ORDER BY capability_id,recorded_at DESC
     ) SELECT * FROM latest ORDER BY capability_id`,
    [context.organizationId],
  );
  const latest = new Map(result.rows.map((row) => [row.capability_id, row]));
  const checks = CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS.map((capabilityId) => {
    const row = latest.get(capabilityId);
    return {
      capabilityId,
      status: row?.status || "missing",
      recordedAt: row?.recorded_at || null,
      evidence: row?.evidence || {},
      contentHash: row?.content_hash || null,
      commitSha: row?.commit_sha || null,
    };
  });
  const passed = checks.filter((check) => check.status === "passed").length;
  return {
    readiness: passed === checks.length ? "ready" : "blocked",
    score: Math.round((passed / checks.length) * 100),
    passed,
    required: checks.length,
    checks,
  };
}
