import { createHash, randomUUID } from "node:crypto";

export const CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS = Object.freeze([
  "CRM-037",
  "CRM-044",
  "CRM-048",
  "CRM-050",
  "CRM-055",
  "CRM-078",
  "CRM-079",
  "CRM-080",
  "CRM-082",
  "CRM-083",
]);

export class CrmPartnerEngagementError extends Error {
  constructor(
    status,
    message,
    code = "CRM_PARTNER_ENGAGEMENT_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "CrmPartnerEngagementError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const text = (v) => String(v ?? "").trim();
const number = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const array = (v) => (Array.isArray(v) ? v : []);
const object = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
const round2 = (v) => Math.round((number(v) + Number.EPSILON) * 100) / 100;
export function crmPartnerEngagementHash(value) {
  const stable = (v) =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function validateJourneyBranchGraph(stepsValue) {
  const steps = array(stepsValue).map((step, index) => ({
    key: text(step.key || `step-${index + 1}`),
    type: text(step.type || "action"),
    next: array(step.next).map(text).filter(Boolean),
    condition: object(step.condition),
    exitGoal: text(step.exitGoal || step.exit_goal),
  }));
  if (!steps.length)
    throw new CrmPartnerEngagementError(
      400,
      "A journey requires at least one step.",
      "CRM_JOURNEY_EMPTY",
    );
  const keys = new Set();
  for (const step of steps) {
    if (!step.key || keys.has(step.key))
      throw new CrmPartnerEngagementError(
        400,
        "Journey step keys must be unique.",
        "CRM_JOURNEY_STEP_DUPLICATE",
      );
    keys.add(step.key);
  }
  for (const step of steps)
    for (const target of step.next)
      if (!keys.has(target))
        throw new CrmPartnerEngagementError(
          400,
          `Unknown journey target: ${target}.`,
          "CRM_JOURNEY_TARGET_UNKNOWN",
        );
  const visiting = new Set(),
    visited = new Set();
  const walk = (key) => {
    if (visiting.has(key))
      throw new CrmPartnerEngagementError(
        400,
        "Journey branches cannot contain cycles.",
        "CRM_JOURNEY_CYCLE",
      );
    if (visited.has(key)) return;
    visiting.add(key);
    const step = steps.find((x) => x.key === key);
    for (const n of step?.next || []) walk(n);
    visiting.delete(key);
    visited.add(key);
  };
  walk(steps[0].key);
  return {
    steps,
    reachable: visited.size,
    valid: visited.size === steps.length,
  };
}
export function validateFieldVisit(input = {}) {
  const latitude = number(input.latitude, NaN),
    longitude = number(input.longitude, NaN);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    throw new CrmPartnerEngagementError(
      400,
      "Valid latitude and longitude are required.",
      "CRM_FIELD_VISIT_LOCATION_INVALID",
    );
  const checkedInAt = new Date(
    input.checkedInAt || input.checked_in_at || Date.now(),
  );
  const checkedOutAt =
    input.checkedOutAt || input.checked_out_at
      ? new Date(input.checkedOutAt || input.checked_out_at)
      : null;
  if (checkedOutAt && checkedOutAt < checkedInAt)
    throw new CrmPartnerEngagementError(
      400,
      "Visit checkout cannot precede check-in.",
      "CRM_FIELD_VISIT_TIME_INVALID",
    );
  return {
    latitude,
    longitude,
    accuracyMeters: Math.max(
      0,
      number(input.accuracyMeters || input.accuracy_meters),
    ),
    checkedInAt: checkedInAt.toISOString(),
    checkedOutAt: checkedOutAt?.toISOString() || null,
  };
}
export function buildCrossChannelCampaignPlan(input = {}) {
  const channels = [
    ...new Set(
      array(input.channels)
        .map(text)
        .filter((v) => ["email", "sms", "social"].includes(v)),
    ),
  ];
  if (!channels.length)
    throw new CrmPartnerEngagementError(
      400,
      "At least one supported campaign channel is required.",
      "CRM_CAMPAIGN_CHANNEL_REQUIRED",
    );
  const audience = Math.max(
    0,
    Math.trunc(number(input.audienceSize || input.audience_size)),
  );
  const frequencyCap = Math.max(
    1,
    Math.trunc(number(input.frequencyCap || input.frequency_cap, 3)),
  );
  return {
    channels,
    audience,
    frequencyCap,
    estimatedMessages: audience * channels.length,
    requiresConsent: channels.filter((c) => c !== "social"),
  };
}
export function routeInboundEmail(input = {}) {
  const from = text(input.from || input.fromEmail),
    subject = text(input.subject),
    body = text(input.body || input.textBody);
  if (!from || !subject)
    throw new CrmPartnerEngagementError(
      400,
      "Inbound email requires sender and subject.",
      "CRM_INBOUND_EMAIL_INVALID",
    );
  const opportunityMatch = `${subject} ${body}`.match(
    /(?:OPP|OPPORTUNITY)[-:#\s]*([A-Z0-9-]{3,})/i,
  );
  const leadMatch = `${subject} ${body}`.match(
    /(?:LEAD)[-:#\s]*([A-Z0-9-]{3,})/i,
  );
  return {
    from,
    subject,
    route: opportunityMatch ? "opportunity" : leadMatch ? "lead" : "new-lead",
    reference: opportunityMatch?.[1] || leadMatch?.[1] || null,
    normalizedEmail: from.toLowerCase(),
  };
}
export function evaluatePartnerDealConflict(existingValue, input = {}) {
  const existing = array(existingValue),
    accountDomain = text(
      input.accountDomain || input.account_domain,
    ).toLowerCase(),
    opportunityName = text(
      input.opportunityName || input.opportunity_name,
    ).toLowerCase();
  const conflicts = existing.filter(
    (row) =>
      ["submitted", "approved"].includes(text(row.status)) &&
      ((accountDomain &&
        text(row.account_domain || row.accountDomain).toLowerCase() ===
          accountDomain) ||
        (opportunityName &&
          text(row.opportunity_name || row.opportunityName).toLowerCase() ===
            opportunityName)),
  );
  return { conflict: conflicts.length > 0, conflicts };
}
export function calculatePartnerIncentive(input = {}) {
  const basis = Math.max(0, number(input.basisAmount || input.basis_amount)),
    rate = Math.min(
      100,
      Math.max(0, number(input.ratePercent || input.rate_percent)),
    ),
    cap = Math.max(
      0,
      number(input.capAmount || input.cap_amount, Number.MAX_SAFE_INTEGER),
    );
  return {
    basisAmount: round2(basis),
    ratePercent: round2(rate),
    incentiveAmount: round2(Math.min(cap, (basis * rate) / 100)),
  };
}
export function calculateConversationScore(
  criteriaValue,
  observationsValue = {},
) {
  const criteria = array(criteriaValue);
  if (!criteria.length)
    throw new CrmPartnerEngagementError(
      400,
      "At least one scorecard criterion is required.",
      "CRM_COACHING_CRITERIA_REQUIRED",
    );
  let weighted = 0,
    totalWeight = 0;
  const observations = object(observationsValue);
  const rows = criteria.map((criterion) => {
    const key = text(criterion.key),
      weight = Math.max(0, number(criterion.weight, 1)),
      max = Math.max(1, number(criterion.maxScore || criterion.max_score, 5)),
      score = Math.min(max, Math.max(0, number(observations[key])));
    weighted += (score / max) * weight;
    totalWeight += weight;
    return { key, score, max, weight };
  });
  return {
    score: round2(totalWeight ? (weighted / totalWeight) * 100 : 0),
    rows,
  };
}
export function calculateGamificationAwards(eventsValue, rulesValue) {
  const events = array(eventsValue),
    rules = array(rulesValue);
  let total = 0;
  const awards = [];
  for (const event of events) {
    const rule = rules.find(
      (r) =>
        text(r.eventType || r.event_type) ===
        text(event.eventType || event.event_type),
    );
    if (!rule) continue;
    const points =
      Math.trunc(number(rule.points)) *
      Math.max(1, Math.trunc(number(event.quantity, 1)));
    total += points;
    awards.push({
      eventType: text(event.eventType || event.event_type),
      points,
    });
  }
  return { totalPoints: total, awards };
}
function assertContext(context) {
  if (!context?.organizationId || !context?.userId)
    throw new CrmPartnerEngagementError(
      401,
      "An authenticated CRM context is required.",
      "CRM_CONTEXT_REQUIRED",
    );
}
export async function registerPartnerDeal(client, context, input = {}) {
  assertContext(context);
  const conflict = await client.query(
    `SELECT id,account_domain,opportunity_name,status FROM tenant.crm_partner_deal_registrations WHERE organization_id=$1 AND status IN ('submitted','approved')`,
    [context.organizationId],
  );
  const evaluated = evaluatePartnerDealConflict(conflict.rows, input);
  if (evaluated.conflict)
    throw new CrmPartnerEngagementError(
      409,
      "A conflicting partner deal registration already exists.",
      "CRM_PARTNER_DEAL_CONFLICT",
      evaluated.conflicts,
    );
  const result = await client.query(
    `INSERT INTO tenant.crm_partner_deal_registrations(organization_id,partner_party_id,account_name,account_domain,opportunity_name,estimated_value,currency_code,status,conflict_evidence,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',$8::jsonb,$9,$9) RETURNING *`,
    [
      context.organizationId,
      input.partnerPartyId || input.partner_party_id || null,
      text(input.accountName || input.account_name),
      text(input.accountDomain || input.account_domain).toLowerCase() || null,
      text(input.opportunityName || input.opportunity_name),
      round2(input.estimatedValue || input.estimated_value),
      text(input.currencyCode || input.currency_code || "INR").toUpperCase(),
      JSON.stringify({ checkedAt: new Date().toISOString(), conflicts: [] }),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function submitMdfRequest(client, context, input = {}) {
  assertContext(context);
  const amount = round2(input.amount);
  if (amount <= 0)
    throw new CrmPartnerEngagementError(
      400,
      "MDF amount must be positive.",
      "CRM_MDF_AMOUNT_INVALID",
    );
  const result = await client.query(
    `INSERT INTO tenant.crm_partner_mdf_requests(organization_id,program_id,partner_party_id,title,amount,currency_code,status,business_case,evidence,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,'submitted',$7,$8::jsonb,$9,$9) RETURNING *`,
    [
      context.organizationId,
      input.programId || input.program_id || null,
      input.partnerPartyId || input.partner_party_id || null,
      text(input.title),
      amount,
      text(input.currencyCode || input.currency_code || "INR").toUpperCase(),
      text(input.businessCase || input.business_case),
      JSON.stringify(object(input.evidence)),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function recordFieldVisit(client, context, input = {}) {
  assertContext(context);
  const visit = validateFieldVisit(input);
  const result = await client.query(
    `INSERT INTO tenant.crm_field_sales_visits(organization_id,user_id,entity_type,entity_id,purpose,latitude,longitude,accuracy_meters,checked_in_at,checked_out_at,outcome,evidence_hash,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$2,$2) RETURNING *`,
    [
      context.organizationId,
      context.userId,
      text(input.entityType || input.entity_type || "lead"),
      input.entityId || input.entity_id || null,
      text(input.purpose),
      visit.latitude,
      visit.longitude,
      visit.accuracyMeters,
      visit.checkedInAt,
      visit.checkedOutAt,
      text(input.outcome),
      crmPartnerEngagementHash({ ...visit, purpose: input.purpose }),
    ],
  );
  return result.rows[0];
}
export async function saveSequenceBranch(client, context, input = {}) {
  assertContext(context);
  const graph = validateJourneyBranchGraph(input.steps);
  const result = await client.query(
    `INSERT INTO tenant.crm_sequence_branch_definitions(organization_id,sequence_id,name,version,graph,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5::jsonb,'active',$6,$6) ON CONFLICT(organization_id,sequence_id,name,version) DO UPDATE SET graph=EXCLUDED.graph,status='active',updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
    [
      context.organizationId,
      input.sequenceId || input.sequence_id || null,
      text(input.name || "Default branching"),
      Math.max(1, Math.trunc(number(input.version, 1))),
      JSON.stringify(graph),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function createCoachingScorecard(client, context, input = {}) {
  assertContext(context);
  const calculated = calculateConversationScore(
    input.criteria,
    input.observations,
  );
  const result = await client.query(
    `INSERT INTO tenant.crm_coaching_scorecards(organization_id,conversation_id,coach_user_id,seller_user_id,score,criteria,observations,feedback,status,content_hash,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'published',$9,$3,$3) RETURNING *`,
    [
      context.organizationId,
      input.conversationId || input.conversation_id || null,
      context.userId,
      input.sellerUserId || input.seller_user_id || context.userId,
      calculated.score,
      JSON.stringify(array(input.criteria)),
      JSON.stringify(object(input.observations)),
      text(input.feedback),
      crmPartnerEngagementHash(calculated),
    ],
  );
  return { ...result.rows[0], calculated };
}
export async function awardGamificationPoints(client, context, input = {}) {
  assertContext(context);
  const award = calculateGamificationAwards(input.events, input.rules);
  const batchId = randomUUID();
  for (const row of award.awards)
    await client.query(
      `INSERT INTO tenant.crm_gamification_events(organization_id,batch_id,user_id,event_type,points,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        context.organizationId,
        batchId,
        input.userId || input.user_id || context.userId,
        row.eventType,
        row.points,
        JSON.stringify(object(input.evidence)),
        context.userId,
      ],
    );
  return { batchId, ...award };
}
export async function processInboundEmail(client, context, input = {}) {
  assertContext(context);
  const routing = routeInboundEmail(input);
  const result = await client.query(
    `INSERT INTO tenant.crm_inbound_email_conversions(organization_id,provider_message_id,from_email,subject,routing_result,entity_type,entity_id,status,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,'processed',$8) ON CONFLICT(organization_id,provider_message_id) DO UPDATE SET routing_result=EXCLUDED.routing_result,status='processed' RETURNING *`,
    [
      context.organizationId,
      text(
        input.providerMessageId ||
          input.provider_message_id ||
          crmPartnerEngagementHash(input),
      ),
      routing.normalizedEmail,
      routing.subject,
      JSON.stringify(routing),
      routing.route,
      input.entityId || input.entity_id || null,
      context.userId,
    ],
  );
  return { ...result.rows[0], routing };
}
export async function getPartnerEngagementDashboard(client, context) {
  assertContext(context);
  const result = await client.query(
    `SELECT (SELECT count(*)::int FROM tenant.crm_partner_deal_registrations WHERE organization_id=$1) AS partner_deals,(SELECT count(*)::int FROM tenant.crm_partner_mdf_requests WHERE organization_id=$1 AND status='submitted') AS mdf_pending,(SELECT count(*)::int FROM tenant.crm_field_sales_visits WHERE organization_id=$1) AS field_visits,(SELECT count(*)::int FROM tenant.crm_coaching_scorecards WHERE organization_id=$1) AS scorecards,(SELECT COALESCE(sum(points),0)::int FROM tenant.crm_gamification_events WHERE organization_id=$1) AS points,(SELECT count(*)::int FROM tenant.crm_inbound_email_conversions WHERE organization_id=$1) AS inbound_conversions`,
    [context.organizationId],
  );
  return result.rows[0];
}
export async function recordCrmPartnerEngagementAcceptance(
  client,
  context,
  input = {},
) {
  assertContext(context);
  const capabilityId = text(input.capabilityId || input.capability_id);
  if (!CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS.includes(capabilityId))
    throw new CrmPartnerEngagementError(
      400,
      "Unknown CRM-10 capability.",
      "CRM10_CAPABILITY_UNKNOWN",
    );
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_partner_engagement_acceptance_evidence(organization_id,capability_id,commit_sha,status,evidence,evidence_hash,verified_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(organization_id,capability_id,commit_sha) DO UPDATE SET status=EXCLUDED.status,evidence=EXCLUDED.evidence,evidence_hash=EXCLUDED.evidence_hash,verified_by=EXCLUDED.verified_by,verified_at=now() RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      text(input.commitSha || input.commit_sha || "local"),
      text(input.status || "passed"),
      JSON.stringify(evidence),
      crmPartnerEngagementHash(evidence),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function getCrmPartnerEngagementReadiness(
  client,
  context,
  commitSha = "local",
) {
  assertContext(context);
  const result = await client.query(
    `SELECT capability_id,status FROM tenant.crm_partner_engagement_acceptance_evidence WHERE organization_id=$1 AND commit_sha=$2`,
    [context.organizationId, commitSha],
  );
  const map = new Map(result.rows.map((r) => [r.capability_id, r.status]));
  const missing = CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS.filter(
    (id) => map.get(id) !== "passed",
  );
  return {
    readiness: missing.length ? "blocked" : "ready",
    passed: CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS.length - missing.length,
    total: CRM_PARTNER_ENGAGEMENT_CAPABILITY_IDS.length,
    missing,
  };
}
