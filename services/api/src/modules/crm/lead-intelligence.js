import { createHash } from "node:crypto";
import { assignLeadOwner } from "./index.js";

export const CRM_LEAD_INTELLIGENCE_CAPABILITY_IDS = Object.freeze([
  "CRM-060",
  "CRM-061",
  "CRM-062",
]);

export class CrmLeadIntelligenceError extends Error {
  constructor(
    status,
    message,
    code = "CRM_LEAD_INTELLIGENCE_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "CrmLeadIntelligenceError";
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
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);
const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

export function crmLeadIntelligenceHash(value) {
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

function comparable(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function attributeMatches(lead, predicate) {
  const field = text(predicate.field);
  const operator = text(predicate.operator || "equals");
  const expected = predicate.value;
  const value =
    lead[field] ??
    lead[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
  switch (operator) {
    case "equals":
      return comparable(value) === comparable(expected);
    case "not_equals":
      return comparable(value) !== comparable(expected);
    case "not_empty":
      return value !== null && value !== undefined && text(value) !== "";
    case "empty":
      return value === null || value === undefined || text(value) === "";
    case "contains":
      return text(value).toLowerCase().includes(text(expected).toLowerCase());
    case "greater_than":
      return number(value, Number.NEGATIVE_INFINITY) > number(expected);
    case "less_than":
      return number(value, Number.POSITIVE_INFINITY) < number(expected);
    case "in":
      return array(expected).map(comparable).includes(comparable(value));
    default:
      return false;
  }
}

export function evaluateLeadScoreRule(
  rule,
  lead,
  events = [],
  now = new Date(),
  halfLifeDays = 30,
) {
  const predicate = object(rule.predicate);
  if (
    rule.signal_type === "demographic" ||
    rule.signal_type === "firmographic"
  ) {
    const matched = attributeMatches(lead, predicate);
    return {
      matched,
      occurrences: matched ? 1 : 0,
      points: matched ? number(rule.points) : 0,
    };
  }
  const eventType = text(predicate.eventType);
  const withinDays = Math.max(1, number(predicate.withinDays, 3650));
  const cutoff = now.getTime() - withinDays * 86400000;
  const matching = events
    .filter((event) => text(event.event_type || event.eventType) === eventType)
    .filter(
      (event) =>
        new Date(event.occurred_at || event.occurredAt || now).getTime() >=
        cutoff,
    )
    .sort(
      (left, right) =>
        new Date(right.occurred_at || right.occurredAt) -
        new Date(left.occurred_at || left.occurredAt),
    );
  const limit =
    rule.maximum_occurrences == null
      ? matching.length
      : Math.min(matching.length, number(rule.maximum_occurrences));
  const selected = matching.slice(0, limit);
  let points = 0;
  for (const event of selected) {
    let contribution = number(rule.points);
    if (rule.decay_enabled) {
      const ageDays = Math.max(
        0,
        (now - new Date(event.occurred_at || event.occurredAt)) / 86400000,
      );
      contribution *= Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
    }
    points += contribution;
  }
  return {
    matched: selected.length > 0,
    occurrences: selected.length,
    points: Math.round(points),
  };
}

export function calculateLeadScoreBreakdown(input = {}) {
  const lead = object(input.lead);
  const model = object(input.model);
  const rules = array(input.rules);
  const events = array(input.events);
  const now =
    input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const floor = number(model.score_floor ?? model.scoreFloor, -100);
  const ceiling = number(model.score_ceiling ?? model.scoreCeiling, 100);
  let score = number(model.base_score ?? model.baseScore);
  const contributions = [];
  for (const rule of rules) {
    if (text(rule.status || "active") !== "active") continue;
    const result = evaluateLeadScoreRule(
      rule,
      lead,
      events,
      now,
      number(model.decay_half_life_days ?? model.decayHalfLifeDays, 30),
    );
    if (!result.matched) continue;
    score += result.points;
    contributions.push({
      ruleId: rule.id ?? null,
      name: rule.name,
      signalType: rule.signal_type,
      points: result.points,
      occurrences: result.occurrences,
    });
  }
  score = Math.round(clamp(score, floor, ceiling));
  const thresholds = object(
    model.qualification_thresholds ?? model.qualificationThresholds,
  );
  const warm = number(thresholds.warm, 30);
  const hot = number(thresholds.hot, 60);
  const qualified = number(thresholds.qualified, 75);
  const grade =
    score >= qualified
      ? "qualified"
      : score >= hot
        ? "hot"
        : score >= warm
          ? "warm"
          : "cold";
  return {
    score,
    grade,
    contributions,
    thresholds: { warm, hot, qualified },
    calculatedAt: now.toISOString(),
  };
}

function parseClock(value, fallbackHour) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
  return match ? [Number(match[1]), Number(match[2])] : [fallbackHour, 0];
}

export function addBusinessMinutes(
  startValue,
  minutesValue,
  scheduleInput = {},
) {
  const schedule = object(scheduleInput);
  const weekdays = new Set(
    array(schedule.weekdays).length
      ? array(schedule.weekdays).map(Number)
      : [1, 2, 3, 4, 5],
  );
  const [startHour, startMinute] = parseClock(schedule.start, 9);
  const [endHour, endMinute] = parseClock(schedule.end, 18);
  let remaining = Math.max(0, Math.ceil(number(minutesValue)));
  let cursor = new Date(startValue);
  const moveToWindow = () => {
    while (true) {
      const day = cursor.getUTCDay();
      const start = new Date(cursor);
      start.setUTCHours(startHour, startMinute, 0, 0);
      const end = new Date(cursor);
      end.setUTCHours(endHour, endMinute, 0, 0);
      if (!weekdays.has(day) || cursor >= end) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        cursor.setUTCHours(startHour, startMinute, 0, 0);
        continue;
      }
      if (cursor < start) cursor = start;
      return end;
    }
  };
  while (remaining > 0) {
    const end = moveToWindow();
    const available = Math.max(0, Math.floor((end - cursor) / 60000));
    const used = Math.min(remaining, available);
    cursor = new Date(cursor.getTime() + used * 60000);
    remaining -= used;
    if (remaining > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(startHour, startMinute, 0, 0);
    }
  }
  return cursor;
}

export function evaluateLeadSlaStatus(slaCase, nowValue = new Date()) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (slaCase.status === "cancelled")
    return { status: "cancelled", breached: false, minutesRemaining: null };
  if (slaCase.first_responded_at || slaCase.firstRespondedAt) {
    const responded = new Date(
      slaCase.first_responded_at || slaCase.firstRespondedAt,
    );
    const due = new Date(slaCase.response_due_at || slaCase.responseDueAt);
    return {
      status: responded <= due ? "compliant" : "breached",
      breached: responded > due,
      minutesRemaining: 0,
    };
  }
  if (slaCase.status === "paused")
    return { status: "paused", breached: false, minutesRemaining: null };
  const due = new Date(slaCase.response_due_at || slaCase.responseDueAt);
  const minutesRemaining = Math.ceil((due - now) / 60000);
  return {
    status: minutesRemaining < 0 ? "breached" : "open",
    breached: minutesRemaining < 0,
    minutesRemaining,
  };
}

export function evaluateNurtureEligibility(
  lead,
  policy,
  nowValue = new Date(),
) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const score = number(lead.score);
  const reasons = [];
  if (
    ["converted", "archived"].includes(text(lead.record_status)) ||
    text(lead.qualification_state) === "unqualified"
  )
    reasons.push("terminal_status");
  if (lead.do_not_contact) reasons.push("do_not_contact");
  const channel = text(
    policy.consent_channel || policy.consentChannel || "any",
  );
  const consent =
    channel === "email"
      ? lead.consent_email
      : channel === "sms"
        ? lead.consent_sms
        : channel === "whatsapp"
          ? lead.consent_whatsapp
          : channel === "call"
            ? !lead.do_not_contact
            : Boolean(
                lead.consent_email ||
                lead.consent_sms ||
                lead.consent_whatsapp ||
                !lead.do_not_contact,
              );
  if (!consent) reasons.push("consent_missing");
  if (
    score < number(policy.minimum_score, -10000) ||
    score > number(policy.maximum_score, 10000)
  )
    reasons.push("score_outside_policy");
  const last = lead.last_contacted_at
    ? new Date(lead.last_contacted_at)
    : new Date(lead.created_at || now);
  const inactivityDays = Math.max(0, Math.floor((now - last) / 86400000));
  if (inactivityDays < number(policy.inactivity_days, 0))
    reasons.push("not_inactive_long_enough");
  return { eligible: reasons.length === 0, reasons, inactivityDays };
}

export function rankNurtureCandidate(input = {}, nowValue = new Date()) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const lead = object(input.lead);
  const inactivityDays = Math.max(
    0,
    Math.floor(
      (now - new Date(lead.last_contacted_at || lead.created_at || now)) /
        86400000,
    ),
  );
  const sla = object(input.sla);
  const slaBoost =
    sla.status === "breached"
      ? 50
      : sla.status === "open" &&
          new Date(sla.response_due_at) < new Date(now.getTime() + 3600000)
        ? 25
        : 0;
  const followUpBoost =
    lead.next_follow_up_at && new Date(lead.next_follow_up_at) <= now ? 30 : 0;
  const priorityBoost =
    { urgent: 30, high: 20, medium: 10, low: 0 }[text(lead.priority)] || 0;
  const score = number(lead.score);
  return (
    Math.round(
      (inactivityDays * 2 +
        slaBoost +
        followUpBoost +
        priorityBoost +
        Math.max(0, 75 - score) / 5) *
        100,
    ) / 100
  );
}

function criteriaMatches(record, criteriaInput) {
  const criteria = object(criteriaInput);
  return Object.entries(criteria).every(([key, expected]) => {
    const value =
      record[key] ??
      record[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
    return Array.isArray(expected)
      ? expected.map(comparable).includes(comparable(value))
      : comparable(value) === comparable(expected);
  });
}

async function activeModel(client, organizationId) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND status='active' ORDER BY version DESC LIMIT 1`,
    [organizationId],
  );
  if (!result.rows[0])
    throw new CrmLeadIntelligenceError(
      409,
      "No active lead scoring model is configured.",
      "CRM_LEAD_SCORING_MODEL_MISSING",
    );
  return result.rows[0];
}

export async function recordLeadBehaviorEvent(client, context, input = {}) {
  const leadId = text(input.leadId || input.lead_id);
  if (!leadId) throw new CrmLeadIntelligenceError(400, "Lead is required.");
  const eventType = text(input.eventType || input.event_type);
  if (!eventType)
    throw new CrmLeadIntelligenceError(400, "Event type is required.");
  const occurredAt =
    input.occurredAt || input.occurred_at || new Date().toISOString();
  const idempotencyKey =
    text(input.idempotencyKey || input.idempotency_key) ||
    crmLeadIntelligenceHash({
      leadId,
      eventType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurredAt,
    });
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_behavior_events(organization_id,company_id,lead_id,event_type,event_value,source_type,source_id,idempotency_key,metadata,occurred_at,created_by)
     SELECT $1,lead.company_id,lead.id,$3,$4,$5,$6,$7,$8,$9,$10 FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2
     ON CONFLICT (organization_id,idempotency_key) DO UPDATE SET received_at=tenant.crm_lead_behavior_events.received_at
     RETURNING *`,
    [
      context.organizationId,
      leadId,
      eventType,
      input.eventValue ?? null,
      text(input.sourceType || "crm"),
      text(input.sourceId) || null,
      idempotencyKey,
      object(input.metadata),
      occurredAt,
      context.userId,
    ],
  );
  if (!result.rows[0])
    throw new CrmLeadIntelligenceError(
      404,
      "Lead not found.",
      "CRM_LEAD_NOT_FOUND",
    );
  const score = await recalculateLeadScore(
    client,
    context,
    leadId,
    `Behaviour event: ${eventType}`,
  );
  return { event: result.rows[0], score };
}

export async function recalculateLeadScore(
  client,
  context,
  leadId,
  reason = "Lead intelligence recalculation",
) {
  const leadResult = await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead)
    throw new CrmLeadIntelligenceError(
      404,
      "Lead not found.",
      "CRM_LEAD_NOT_FOUND",
    );
  const model = await activeModel(client, context.organizationId);
  const [rulesResult, eventsResult] = await Promise.all([
    client.query(
      `SELECT * FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 AND model_id=$2 AND status='active' ORDER BY sequence,id`,
      [context.organizationId, model.id],
    ),
    client.query(
      `SELECT * FROM tenant.crm_lead_behavior_events WHERE organization_id=$1 AND lead_id=$2 AND occurred_at>=now()-interval '5 years' ORDER BY occurred_at DESC`,
      [context.organizationId, leadId],
    ),
  ]);
  const breakdown = calculateLeadScoreBreakdown({
    lead,
    model,
    rules: rulesResult.rows,
    events: eventsResult.rows,
  });
  const explanation = {
    model: { id: model.id, name: model.name, version: model.version },
    thresholds: breakdown.thresholds,
    contributions: JSON.stringify(breakdown.contributions),
    reason,
  };
  const contentHash = crmLeadIntelligenceHash({
    leadId,
    score: breakdown.score,
    grade: breakdown.grade,
    explanation,
    calculatedAt: breakdown.calculatedAt,
  });
  await client.query(
    `UPDATE tenant.crm_leads SET score=$1,lead_grade=$2,score_model_id=$3,score_calculated_at=$4,score_explanation=$5,updated_by=$6,updated_at=now() WHERE organization_id=$7 AND id=$8`,
    [
      breakdown.score,
      breakdown.grade,
      model.id,
      breakdown.calculatedAt,
      explanation,
      context.userId,
      context.organizationId,
      leadId,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_lead_score_snapshots(organization_id,company_id,lead_id,model_id,score,grade,contributions,explanation,content_hash,calculated_at,calculated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      context.organizationId,
      lead.company_id,
      leadId,
      model.id,
      breakdown.score,
      breakdown.grade,
      breakdown.contributions,
      explanation,
      contentHash,
      breakdown.calculatedAt,
      context.userId,
    ],
  );
  if (number(lead.score) !== breakdown.score) {
    await client.query(
      `INSERT INTO tenant.crm_lead_score_history(organization_id,lead_id,previous_score,new_score,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        context.organizationId,
        leadId,
        number(lead.score),
        breakdown.score,
        reason,
        context.userId,
      ],
    );
  }
  return { leadId, ...breakdown, explanation, contentHash };
}

export async function getLeadScoreExplanation(client, context, leadId) {
  const result = await client.query(
    `SELECT lead.id,lead.code,lead.full_name,lead.score,lead.lead_grade,lead.score_calculated_at,lead.score_explanation,snapshot.content_hash,snapshot.calculated_at AS snapshot_at FROM tenant.crm_leads lead LEFT JOIN LATERAL (SELECT * FROM tenant.crm_lead_score_snapshots s WHERE s.organization_id=lead.organization_id AND s.lead_id=lead.id ORDER BY s.calculated_at DESC LIMIT 1) snapshot ON true WHERE lead.organization_id=$1 AND lead.id=$2`,
    [context.organizationId, leadId],
  );
  if (!result.rows[0])
    throw new CrmLeadIntelligenceError(
      404,
      "Lead not found.",
      "CRM_LEAD_NOT_FOUND",
    );
  return result.rows[0];
}

export async function openLeadSlaCase(client, context, leadId, input = {}) {
  const leadResult = await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead)
    throw new CrmLeadIntelligenceError(
      404,
      "Lead not found.",
      "CRM_LEAD_NOT_FOUND",
    );
  const policies = await client.query(
    `SELECT * FROM tenant.crm_lead_sla_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
    [context.organizationId],
  );
  const policy = policies.rows.find((candidate) =>
    criteriaMatches(lead, candidate.criteria),
  );
  if (!policy)
    throw new CrmLeadIntelligenceError(
      409,
      "No matching lead SLA policy is configured.",
      "CRM_LEAD_SLA_POLICY_MISSING",
    );
  const startedAt = new Date(input.startedAt || lead.created_at || Date.now());
  const dueAt = addBusinessMinutes(
    startedAt,
    policy.first_response_minutes,
    policy.business_hours,
  );
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_sla_cases(organization_id,company_id,lead_id,policy_id,owner_user_id,started_at,response_due_at,status,evidence,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$9)
     ON CONFLICT (organization_id,lead_id) WHERE status IN ('open','paused','breached')
     DO UPDATE SET policy_id=EXCLUDED.policy_id,owner_user_id=EXCLUDED.owner_user_id,response_due_at=EXCLUDED.response_due_at,evidence=tenant.crm_lead_sla_cases.evidence||EXCLUDED.evidence,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      lead.company_id,
      lead.id,
      policy.id,
      lead.owner_user_id,
      startedAt,
      dueAt,
      object(input.evidence),
      context.userId,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_lead_sla_events(organization_id,sla_case_id,lead_id,event_type,evidence,created_by) VALUES($1,$2,$3,'started',$4,$5)`,
    [
      context.organizationId,
      result.rows[0].id,
      lead.id,
      { policyId: policy.id, responseDueAt: dueAt.toISOString() },
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function recordLeadResponse(client, context, leadId, input = {}) {
  const respondedAt = new Date(input.respondedAt || Date.now());
  const leadResult = await client.query(
    `UPDATE tenant.crm_leads SET first_responded_at=COALESCE(first_responded_at,$1),last_contacted_at=GREATEST(COALESCE(last_contacted_at,$1),$1),updated_by=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 RETURNING *`,
    [respondedAt, context.userId, context.organizationId, leadId],
  );
  if (!leadResult.rows[0])
    throw new CrmLeadIntelligenceError(
      404,
      "Lead not found.",
      "CRM_LEAD_NOT_FOUND",
    );
  const cases = await client.query(
    `SELECT * FROM tenant.crm_lead_sla_cases WHERE organization_id=$1 AND lead_id=$2 AND status IN ('open','paused','breached') ORDER BY created_at DESC FOR UPDATE`,
    [context.organizationId, leadId],
  );
  for (const slaCase of cases.rows) {
    const status =
      respondedAt <= new Date(slaCase.response_due_at)
        ? "compliant"
        : "breached";
    await client.query(
      `UPDATE tenant.crm_lead_sla_cases SET first_responded_at=$1,status=$2,breached_at=CASE WHEN $2='breached' THEN COALESCE(breached_at,$1) ELSE breached_at END,evidence=evidence||$3,updated_by=$4,updated_at=now() WHERE organization_id=$5 AND id=$6`,
      [
        respondedAt,
        status,
        {
          responseType: input.responseType || "manual",
          sourceId: input.sourceId || null,
        },
        context.userId,
        context.organizationId,
        slaCase.id,
      ],
    );
    await client.query(
      `INSERT INTO tenant.crm_lead_sla_events(organization_id,sla_case_id,lead_id,event_type,evidence,created_by) VALUES($1,$2,$3,'responded',$4,$5)`,
      [
        context.organizationId,
        slaCase.id,
        leadId,
        { respondedAt: respondedAt.toISOString(), status },
        context.userId,
      ],
    );
  }
  return { lead: leadResult.rows[0], cases: cases.rows.length };
}

export async function scanLeadSlaBreaches(
  client,
  context,
  nowValue = new Date(),
) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const result = await client.query(
    `SELECT sla.*,policy.escalation_user_id,policy.reassign_on_breach
       FROM tenant.crm_lead_sla_cases sla
       JOIN tenant.crm_lead_sla_policies policy
         ON policy.organization_id=sla.organization_id AND policy.id=sla.policy_id
       JOIN tenant.crm_leads lead
         ON lead.organization_id=sla.organization_id AND lead.id=sla.lead_id
      WHERE sla.organization_id=$1 AND sla.status='open'
        AND sla.first_responded_at IS NULL AND sla.response_due_at<$2
        AND ($3::uuid IS NULL OR lead.company_id IS NULL OR lead.company_id=$3)
        AND ($4::uuid IS NULL OR lead.branch_id IS NULL OR lead.branch_id=$4)
        AND ($3::uuid IS NOT NULL OR $5::boolean)
      FOR UPDATE OF sla`,
    [
      context.organizationId,
      now,
      context.activeCompanyId || null,
      context.activeBranchId || null,
      Boolean(context.allowAllCompanies),
    ],
  );
  for (const slaCase of result.rows) {
    await client.query(
      `UPDATE tenant.crm_lead_sla_cases SET status='breached',breached_at=COALESCE(breached_at,$1),escalated_at=CASE WHEN $2::uuid IS NOT NULL THEN COALESCE(escalated_at,$1) ELSE escalated_at END,updated_by=$3,updated_at=now() WHERE organization_id=$4 AND id=$5`,
      [
        now,
        slaCase.escalation_user_id,
        context.userId,
        context.organizationId,
        slaCase.id,
      ],
    );
    await client.query(
      `INSERT INTO tenant.crm_lead_sla_events(organization_id,sla_case_id,lead_id,event_type,evidence,created_by) VALUES($1,$2,$3,'breached',$4,$5)`,
      [
        context.organizationId,
        slaCase.id,
        slaCase.lead_id,
        { responseDueAt: slaCase.response_due_at },
        context.userId,
      ],
    );
    if (slaCase.reassign_on_breach && slaCase.escalation_user_id) {
      await assignLeadOwner(
        client,
        context,
        slaCase.lead_id,
        slaCase.escalation_user_id,
        { reason: "sla:breach" },
      );
      await client.query(
        `INSERT INTO tenant.crm_lead_sla_events(organization_id,sla_case_id,lead_id,event_type,evidence,created_by) VALUES($1,$2,$3,'reassigned',$4,$5)`,
        [
          context.organizationId,
          slaCase.id,
          slaCase.lead_id,
          { ownerUserId: slaCase.escalation_user_id },
          context.userId,
        ],
      );
    }
  }
  return { scanned: result.rows.length, breached: result.rows.length };
}

export async function refreshLeadNurtureQueue(
  client,
  context,
  nowValue = new Date(),
) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const [policiesResult, leadsResult] = await Promise.all([
    client.query(
      `SELECT * FROM tenant.crm_lead_nurture_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
      [context.organizationId],
    ),
    client.query(
      `SELECT lead.*,sla.status AS sla_status,sla.response_due_at FROM tenant.crm_leads lead LEFT JOIN LATERAL (SELECT status,response_due_at FROM tenant.crm_lead_sla_cases c WHERE c.organization_id=lead.organization_id AND c.lead_id=lead.id ORDER BY c.created_at DESC LIMIT 1) sla ON true WHERE lead.organization_id=$1 AND lead.record_status='active'`,
      [context.organizationId],
    ),
  ]);
  let generated = 0;
  let exited = 0;
  for (const lead of leadsResult.rows) {
    const policy = policiesResult.rows.find((candidate) =>
      criteriaMatches(lead, candidate.criteria),
    );
    if (!policy) continue;
    const eligibility = evaluateNurtureEligibility(lead, policy, now);
    if (!eligibility.eligible) {
      const update = await client.query(
        `UPDATE tenant.crm_lead_nurture_queue SET status='exited',exited_at=$1,exit_reason=$2,updated_by=$3,updated_at=now() WHERE organization_id=$4 AND lead_id=$5 AND status IN ('active','claimed','snoozed') RETURNING id`,
        [
          now,
          eligibility.reasons.join(","),
          context.userId,
          context.organizationId,
          lead.id,
        ],
      );
      exited += update.rowCount || 0;
      continue;
    }
    const priorityScore = rankNurtureCandidate(
      {
        lead,
        sla: { status: lead.sla_status, response_due_at: lead.response_due_at },
      },
      now,
    );
    const reasons = [
      eligibility.inactivityDays > 0
        ? `inactive_${eligibility.inactivityDays}_days`
        : "new_lead",
      lead.sla_status === "breached" ? "sla_breached" : null,
      lead.next_follow_up_at && new Date(lead.next_follow_up_at) <= now
        ? "follow_up_due"
        : null,
    ].filter(Boolean);
    const dueAt =
      lead.next_follow_up_at && new Date(lead.next_follow_up_at) > now
        ? new Date(lead.next_follow_up_at)
        : now;
    await client.query(
      `INSERT INTO tenant.crm_lead_nurture_queue(organization_id,company_id,lead_id,policy_id,owner_user_id,priority_score,recommended_action,reason_codes,due_at,status,last_generated_at,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$11)
       ON CONFLICT (organization_id,lead_id) WHERE status IN ('active','claimed','snoozed')
       DO UPDATE SET policy_id=EXCLUDED.policy_id,owner_user_id=EXCLUDED.owner_user_id,priority_score=EXCLUDED.priority_score,recommended_action=EXCLUDED.recommended_action,reason_codes=EXCLUDED.reason_codes,due_at=EXCLUDED.due_at,last_generated_at=EXCLUDED.last_generated_at,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [
        context.organizationId,
        lead.company_id,
        lead.id,
        policy.id,
        lead.owner_user_id,
        priorityScore,
        policy.action_type,
        reasons,
        dueAt,
        now,
        context.userId,
      ],
    );
    generated += 1;
  }
  return { evaluated: leadsResult.rows.length, generated, exited };
}

export async function updateLeadNurtureItem(
  client,
  context,
  itemId,
  input = {},
) {
  const action = text(input.action);
  const itemResult = await client.query(
    `SELECT * FROM tenant.crm_lead_nurture_queue WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, itemId],
  );
  const item = itemResult.rows[0];
  if (!item)
    throw new CrmLeadIntelligenceError(
      404,
      "Nurture item not found.",
      "CRM_NURTURE_ITEM_NOT_FOUND",
    );
  let result;
  if (action === "claim")
    result = await client.query(
      `UPDATE tenant.crm_lead_nurture_queue SET status='claimed',claimed_by=$1,claimed_at=now(),updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3 AND status IN ('active','snoozed') RETURNING *`,
      [context.userId, context.organizationId, itemId],
    );
  else if (action === "complete")
    result = await client.query(
      `UPDATE tenant.crm_lead_nurture_queue SET status='completed',completed_at=now(),updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3 AND status IN ('active','claimed','snoozed') RETURNING *`,
      [context.userId, context.organizationId, itemId],
    );
  else if (action === "snooze")
    result = await client.query(
      `UPDATE tenant.crm_lead_nurture_queue SET status='snoozed',snoozed_until=$1,due_at=$1,updated_by=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 AND status IN ('active','claimed') RETURNING *`,
      [
        new Date(input.until || Date.now() + 86400000),
        context.userId,
        context.organizationId,
        itemId,
      ],
    );
  else if (action === "exit")
    result = await client.query(
      `UPDATE tenant.crm_lead_nurture_queue SET status='exited',exited_at=now(),exit_reason=$1,updated_by=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 AND status IN ('active','claimed','snoozed') RETURNING *`,
      [
        text(input.reason || "manual_exit"),
        context.userId,
        context.organizationId,
        itemId,
      ],
    );
  else throw new CrmLeadIntelligenceError(400, "Unsupported nurture action.");
  if (!result.rows[0])
    throw new CrmLeadIntelligenceError(
      409,
      "Nurture item is no longer actionable.",
    );
  return result.rows[0];
}

export async function getLeadIntelligenceDashboard(client, context) {
  const [summary, grades, sla, queue, topQueue] = await Promise.all([
    client.query(
      `SELECT count(*) FILTER (WHERE record_status='active')::int AS active_leads,count(*) FILTER (WHERE lead_grade='qualified')::int AS qualified_leads,round(avg(score),2) AS average_score,count(*) FILTER (WHERE score_calculated_at IS NULL)::int AS unscored_leads FROM tenant.crm_leads WHERE organization_id=$1`,
      [context.organizationId],
    ),
    client.query(
      `SELECT lead_grade,count(*)::int AS leads FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active' GROUP BY lead_grade ORDER BY CASE lead_grade WHEN 'qualified' THEN 1 WHEN 'hot' THEN 2 WHEN 'warm' THEN 3 ELSE 4 END`,
      [context.organizationId],
    ),
    client.query(
      `SELECT status,count(*)::int AS cases FROM tenant.crm_lead_sla_cases WHERE organization_id=$1 GROUP BY status ORDER BY status`,
      [context.organizationId],
    ),
    client.query(
      `SELECT status,count(*)::int AS items FROM tenant.crm_lead_nurture_queue WHERE organization_id=$1 GROUP BY status ORDER BY status`,
      [context.organizationId],
    ),
    client.query(
      `SELECT queue.id,queue.priority_score,queue.recommended_action,queue.reason_codes,queue.due_at,queue.status,lead.id AS lead_id,lead.code,lead.full_name,lead.company_name,lead.score,lead.lead_grade,lead.owner_user_id FROM tenant.crm_lead_nurture_queue queue JOIN tenant.crm_leads lead ON lead.organization_id=queue.organization_id AND lead.id=queue.lead_id WHERE queue.organization_id=$1 AND queue.status IN ('active','claimed','snoozed') AND (queue.snoozed_until IS NULL OR queue.snoozed_until<=now()) ORDER BY queue.priority_score DESC,queue.due_at LIMIT 50`,
      [context.organizationId],
    ),
  ]);
  return {
    summary: summary.rows[0],
    grades: grades.rows,
    sla: sla.rows,
    queue: queue.rows,
    topQueue: topQueue.rows,
  };
}

export async function recordCrmLeadIntelligenceAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId || input.capability_id);
  if (!CRM_LEAD_INTELLIGENCE_CAPABILITY_IDS.includes(capabilityId))
    throw new CrmLeadIntelligenceError(
      400,
      "Unknown CRM lead-intelligence capability.",
    );
  const commitSha = text(input.commitSha || input.commit_sha);
  if (!commitSha)
    throw new CrmLeadIntelligenceError(400, "Commit SHA is required.");
  const evidence = object(input.evidence);
  const status = text(input.status || "passed");
  const evidenceHash = crmLeadIntelligenceHash({
    capabilityId,
    commitSha,
    status,
    evidence,
  });
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_intelligence_acceptance_runs(organization_id,capability_id,commit_sha,status,evidence,evidence_hash,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id,capability_id,commit_sha) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      commitSha,
      status,
      evidence,
      evidenceHash,
      context.userId,
    ],
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await client.query(
    `SELECT * FROM tenant.crm_lead_intelligence_acceptance_runs WHERE organization_id=$1 AND capability_id=$2 AND commit_sha=$3`,
    [context.organizationId, capabilityId, commitSha],
  );
  return existing.rows[0];
}

export async function getCrmLeadIntelligenceReadiness(
  client,
  context,
  commitSha = null,
) {
  const [models, rules, slaPolicies, nurturePolicies, acceptance] =
    await Promise.all([
      client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND status='active'`,
        [context.organizationId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 AND status='active'`,
        [context.organizationId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_lead_sla_policies WHERE organization_id=$1 AND status='active'`,
        [context.organizationId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_lead_nurture_policies WHERE organization_id=$1 AND status='active'`,
        [context.organizationId],
      ),
      client.query(
        `SELECT capability_id,status,commit_sha,recorded_at FROM tenant.crm_lead_intelligence_acceptance_runs WHERE organization_id=$1 AND ($2::text IS NULL OR commit_sha=$2) ORDER BY recorded_at DESC`,
        [context.organizationId, commitSha],
      ),
    ]);
  const latest = new Map();
  for (const row of acceptance.rows)
    if (!latest.has(row.capability_id)) latest.set(row.capability_id, row);
  const checks = [
    { key: "active-model", passed: number(models.rows[0]?.count) === 1 },
    { key: "active-rules", passed: number(rules.rows[0]?.count) >= 3 },
    { key: "sla-policy", passed: number(slaPolicies.rows[0]?.count) >= 1 },
    {
      key: "nurture-policy",
      passed: number(nurturePolicies.rows[0]?.count) >= 1,
    },
    ...CRM_LEAD_INTELLIGENCE_CAPABILITY_IDS.map((id) => ({
      key: id,
      passed: latest.get(id)?.status === "passed",
    })),
  ];
  const passed = checks.filter((check) => check.passed).length;
  return {
    readiness: passed === checks.length ? "ready" : "blocked",
    score: Math.round((passed / checks.length) * 100),
    checks,
    acceptance: [...latest.values()],
  };
}
