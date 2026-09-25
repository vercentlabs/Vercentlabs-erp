import { assignLeadOwner } from "./lead-assignment.js";
// F027 Lead scoring: the error class, sensitive-scope guard, scoped-Lead
// fetch and content hash used to be defined here; they moved to
// lead-lifecycle-qualification-and-prioritization/scoring/shared.js as
// part of CRM vNext Prompt 4 so the scoring engine and this file's own
// (non-F027) SLA/nurture functions can both depend on them without a
// circular import. Re-exported below for compatibility.
import {
  CrmLeadIntelligenceError,
  assertSensitiveLeadIntelligenceAccess,
  getScopedLead,
  scopedLeadWhere,
  crmLeadIntelligenceHash,
  text,
  number,
  object,
  array,
} from "./scoring/shared.js";
export { CrmLeadIntelligenceError, assertSensitiveLeadIntelligenceAccess, getScopedLead, crmLeadIntelligenceHash };
// F027 Lead scoring: evaluateLeadScoreRule/calculateLeadScoreBreakdown/
// recalculateLeadScore/getLeadScoreExplanation moved to
// lead-lifecycle-qualification-and-prioritization/scoring/scoring-engine.js
// as part of CRM vNext Prompt 4 — re-exported below for compatibility.
export { evaluateLeadScoreRule, calculateLeadScoreBreakdown, recalculateLeadScore, getLeadScoreExplanation } from "./scoring/scoring-engine.js";
import { recalculateLeadScore } from "./scoring/scoring-engine.js";

export const CRM_LEAD_INTELLIGENCE_CAPABILITY_IDS = Object.freeze([
  "CRM-060",
  "CRM-061",
  "CRM-062",
]);

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

function comparable(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
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

export async function recordLeadBehaviorEvent(client, context, input = {}) {
  assertSensitiveLeadIntelligenceAccess(context);
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
  await getScopedLead(client, context, leadId);
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

export async function openLeadSlaCase(client, context, leadId, input = {}) {
  assertSensitiveLeadIntelligenceAccess(context);
  const lead = await getScopedLead(client, context, leadId, { lock: true });
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
  assertSensitiveLeadIntelligenceAccess(context);
  const respondedAt = new Date(input.respondedAt || Date.now());
  await getScopedLead(client, context, leadId, { lock: true });
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
  assertSensitiveLeadIntelligenceAccess(context);
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
  assertSensitiveLeadIntelligenceAccess(context);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const leadValues = [context.organizationId];
  const leadScope = scopedLeadWhere(context, leadValues);
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const policiesResult = await client.query(
    `SELECT * FROM tenant.crm_lead_nurture_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
    [context.organizationId],
  );
  const leadsResult = await client.query(
    `SELECT lead.*,sla.status AS sla_status,sla.response_due_at FROM tenant.crm_leads lead LEFT JOIN LATERAL (SELECT status,response_due_at FROM tenant.crm_lead_sla_cases c WHERE c.organization_id=lead.organization_id AND c.lead_id=lead.id ORDER BY c.created_at DESC LIMIT 1) sla ON true WHERE lead.organization_id=$1 AND lead.record_status='active'${leadScope}`,
    leadValues,
  );
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
  assertSensitiveLeadIntelligenceAccess(context);
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
  await getScopedLead(client, context, item.lead_id);
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

// F016 Follow-ups and reminders: per owner decision, the nurture queue IS
// F016's real implementation (it already has the snooze/claim/complete/
// dedup/priority-scoring behavior the dossier asks for) rather than the
// thin next_follow_up_at field. "My Follow-ups" means mine, full stop —
// mirroring the existing rule for the old next_follow_up_at-based list
// (see apps/web/src/orchestration/work/follow-ups.ts), a manager's
// crm.records.view_all must never broaden this to everyone's queue, so the
// permission used for owner-scoping is deliberately stripped down to just
// the sensitive-intelligence permission the dashboard query itself requires.
export async function listMyNurtureQueueItems(client, context, limit = 50) {
  assertSensitiveLeadIntelligenceAccess(context);
  const scopedContext = { ...context, permissions: ["crm.leads.view_sensitive"], roleSlugs: [], ownRecordsOnly: true };
  const values = [context.organizationId];
  const scope = scopedLeadWhere(scopedContext, values);
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const result = await client.query(
    `SELECT queue.id, queue.priority_score, queue.recommended_action, queue.reason_codes,
            queue.due_at, queue.status, queue.snoozed_until,
            lead.id AS lead_id, lead.code, lead.full_name, lead.company_name,
            lead.score, lead.lead_grade
       FROM tenant.crm_lead_nurture_queue queue
       JOIN tenant.crm_leads lead ON lead.organization_id=queue.organization_id AND lead.id=queue.lead_id
      WHERE queue.organization_id=$1
        AND queue.status IN ('active','claimed','snoozed')
        AND (queue.snoozed_until IS NULL OR queue.snoozed_until<=now())
        AND lead.record_status='active'${scope}
      ORDER BY queue.priority_score DESC, queue.due_at
      LIMIT ${boundedLimit}`,
    values,
  );
  return result.rows;
}

// CRM-VNEXT-052 closeout (nurture-queue half): the real delivery mechanism
// this queue never had. Claims due, not-yet-notified items via
// `FOR UPDATE SKIP LOCKED` and marks notified_at atomically in the same
// UPDATE — deliberately a single-attempt notification (not a retryable
// pending/dispatching/sent state machine like F016's Scheduled Follow-up
// reminders): a missed nurture ping is a recommendation the seller will see
// again next time refreshLeadNurtureQueue() re-ranks the queue, not a
// committed reminder a caller is relying on, so the added complexity of a
// stuck-row recovery path is not proportionate here. System-context callers
// (the worker) intentionally bypass per-user Lead scoping — this claims
// across the WHOLE organization's queue, then the worker notifies each
// item's actual owner_user_id, never the caller.
export async function claimDueNurtureQueueItems(client, context, { limit = 200 } = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 200)));
  const result = await client.query(
    `UPDATE tenant.crm_lead_nurture_queue queue
        SET notified_at=now()
      WHERE queue.id IN (
        SELECT id FROM tenant.crm_lead_nurture_queue
         WHERE organization_id=$1 AND status='active' AND notified_at IS NULL
           AND due_at<=now() AND (snoozed_until IS NULL OR snoozed_until<=now())
         ORDER BY priority_score DESC, due_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING queue.*`,
    [context.organizationId, boundedLimit],
  );
  if (!result.rows.length) return [];
  const leadIds = [...new Set(result.rows.map((row) => row.lead_id))];
  const leads = await client.query(
    `SELECT lead.id,lead.code,lead.full_name,lead.company_name,lead.owner_user_id,u.full_name AS owner_name,u.email AS owner_email
       FROM tenant.crm_leads lead LEFT JOIN public.users u ON u.id=lead.owner_user_id
      WHERE lead.organization_id=$1 AND lead.id = ANY($2::uuid[])`,
    [context.organizationId, leadIds],
  );
  const byLeadId = new Map(leads.rows.map((row) => [row.id, row]));
  return result.rows.map((row) => ({ ...row, lead: byLeadId.get(row.lead_id) || null }));
}

export async function getLeadIntelligenceDashboard(client, context) {
  assertSensitiveLeadIntelligenceAccess(context);
  const summaryValues = [context.organizationId];
  const summaryScope = scopedLeadWhere(context, summaryValues);
  const gradeValues = [context.organizationId];
  const gradeScope = scopedLeadWhere(context, gradeValues);
  const slaValues = [context.organizationId];
  const slaScope = scopedLeadWhere(context, slaValues);
  const queueValues = [context.organizationId];
  const queueScope = scopedLeadWhere(context, queueValues);
  const topValues = [context.organizationId];
  const topScope = scopedLeadWhere(context, topValues);
  // Sequential, not Promise.all: these queries share one PoolClient with
  // dynamic, differing parameter counts (scopedLeadWhere() conditionally
  // appends scope params per call) — firing them concurrently risks the
  // extended-query protocol interleaving Parse/Bind across queries
  // (observed live as Postgres 08P01 "bind message supplies N parameters,
  // but prepared statement "" requires M"). See
  // opportunity-revenue-intelligence.js's identical fix.
  const summary = await client.query(
    `SELECT count(*) FILTER (WHERE lead.record_status='active')::int AS active_leads,count(*) FILTER (WHERE lead.lead_grade='qualified')::int AS qualified_leads,round(avg(lead.score),2) AS average_score,count(*) FILTER (WHERE lead.score_calculated_at IS NULL)::int AS unscored_leads FROM tenant.crm_leads lead WHERE lead.organization_id=$1${summaryScope}`,
    summaryValues,
  );
  const grades = await client.query(
    `SELECT lead.lead_grade,count(*)::int AS leads FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.record_status='active'${gradeScope} GROUP BY lead.lead_grade ORDER BY CASE lead.lead_grade WHEN 'qualified' THEN 1 WHEN 'hot' THEN 2 WHEN 'warm' THEN 3 ELSE 4 END`,
    gradeValues,
  );
  const sla = await client.query(
    `SELECT sla_case.status,count(*)::int AS cases FROM tenant.crm_lead_sla_cases sla_case JOIN tenant.crm_leads lead ON lead.organization_id=sla_case.organization_id AND lead.id=sla_case.lead_id WHERE sla_case.organization_id=$1${slaScope} GROUP BY sla_case.status ORDER BY sla_case.status`,
    slaValues,
  );
  const queue = await client.query(
    `SELECT queue.status,count(*)::int AS items FROM tenant.crm_lead_nurture_queue queue JOIN tenant.crm_leads lead ON lead.organization_id=queue.organization_id AND lead.id=queue.lead_id WHERE queue.organization_id=$1${queueScope} GROUP BY queue.status ORDER BY queue.status`,
    queueValues,
  );
  const topQueue = await client.query(
    `SELECT queue.id,queue.priority_score,queue.recommended_action,queue.reason_codes,queue.due_at,queue.status,lead.id AS lead_id,lead.code,lead.full_name,lead.company_name,lead.score,lead.lead_grade,lead.owner_user_id FROM tenant.crm_lead_nurture_queue queue JOIN tenant.crm_leads lead ON lead.organization_id=queue.organization_id AND lead.id=queue.lead_id WHERE queue.organization_id=$1 AND queue.status IN ('active','claimed','snoozed') AND (queue.snoozed_until IS NULL OR queue.snoozed_until<=now())${topScope} ORDER BY queue.priority_score DESC,queue.due_at LIMIT 50`,
    topValues,
  );
  return { summary: summary.rows[0], grades: grades.rows, sla: sla.rows, queue: queue.rows, topQueue: topQueue.rows };
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
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const models = await client.query(
    `SELECT count(*)::int AS count FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND status='active'`,
    [context.organizationId],
  );
  const rules = await client.query(
    `SELECT count(*)::int AS count FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 AND status='active'`,
    [context.organizationId],
  );
  const slaPolicies = await client.query(
    `SELECT count(*)::int AS count FROM tenant.crm_lead_sla_policies WHERE organization_id=$1 AND status='active'`,
    [context.organizationId],
  );
  const nurturePolicies = await client.query(
    `SELECT count(*)::int AS count FROM tenant.crm_lead_nurture_policies WHERE organization_id=$1 AND status='active'`,
    [context.organizationId],
  );
  const acceptance = await client.query(
    `SELECT capability_id,status,commit_sha,recorded_at FROM tenant.crm_lead_intelligence_acceptance_runs WHERE organization_id=$1 AND ($2::text IS NULL OR commit_sha=$2) ORDER BY recorded_at DESC`,
    [context.organizationId, commitSha],
  );
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
