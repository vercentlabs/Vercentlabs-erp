// F027 Lead scoring — the ONE deterministic scoring engine
// (crm_lead_scoring_models / crm_lead_scoring_model_rules, "System A").
// Moved here (from the legacy flat lead-intelligence.js) as part of CRM
// vNext Prompt 4, which also retired a second, parallel legacy scoring
// path ("System B", tenant.crm_scoring_rules) that had been silently
// overwriting crm_leads.score on every Lead create/update with no model
// version, cap or decay — see index.js's create/update paths and
// CrmError-throwing callers, now all pointed at recalculateLeadScoreInternal
// below instead.
import { CrmLeadIntelligenceError, assertSensitiveLeadIntelligenceAccess, getScopedLead, crmLeadIntelligenceHash, text, number, object, array, clamp } from "./shared.js";

function comparable(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function attributeMatches(lead, predicate) {
  const field = text(predicate.field);
  const operator = text(predicate.operator || "equals");
  const expected = predicate.value;
  const value = lead[field] ?? lead[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
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

export function evaluateLeadScoreRule(rule, lead, events = [], now = new Date(), halfLifeDays = 30) {
  const predicate = object(rule.predicate);
  if (rule.signal_type === "demographic" || rule.signal_type === "firmographic") {
    const matched = attributeMatches(lead, predicate);
    return { matched, occurrences: matched ? 1 : 0, points: matched ? number(rule.points) : 0 };
  }
  const eventType = text(predicate.eventType);
  const withinDays = Math.max(1, number(predicate.withinDays, 3650));
  const cutoff = now.getTime() - withinDays * 86400000;
  const matching = events
    .filter((event) => text(event.event_type || event.eventType) === eventType)
    .filter((event) => new Date(event.occurred_at || event.occurredAt || now).getTime() >= cutoff)
    .sort((left, right) => new Date(right.occurred_at || right.occurredAt) - new Date(left.occurred_at || left.occurredAt));
  const limit = rule.maximum_occurrences == null ? matching.length : Math.min(matching.length, number(rule.maximum_occurrences));
  const selected = matching.slice(0, limit);
  let points = 0;
  for (const event of selected) {
    let contribution = number(rule.points);
    if (rule.decay_enabled) {
      const ageDays = Math.max(0, (now - new Date(event.occurred_at || event.occurredAt)) / 86400000);
      contribution *= Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
    }
    points += contribution;
  }
  return { matched: selected.length > 0, occurrences: selected.length, points: Math.round(points) };
}

// Pure and deterministic (F027-CALC-001): given the same lead/model/rules/
// events/now, always the same score. No I/O, no Date.now() default (the
// caller always supplies `now`), no dependency on rule/candidate ordering
// beyond the rules array itself (which callers load pre-sorted by sequence).
export function calculateLeadScoreBreakdown(input = {}) {
  const lead = object(input.lead);
  const model = object(input.model);
  const rules = array(input.rules);
  const events = array(input.events);
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const floor = number(model.score_floor ?? model.scoreFloor, -100);
  const ceiling = number(model.score_ceiling ?? model.scoreCeiling, 100);
  let score = number(model.base_score ?? model.baseScore);
  const contributions = [];
  for (const rule of rules) {
    if (text(rule.status || "active") !== "active") continue;
    const result = evaluateLeadScoreRule(rule, lead, events, now, number(model.decay_half_life_days ?? model.decayHalfLifeDays, 30));
    if (!result.matched) continue;
    score += result.points;
    contributions.push({ ruleId: rule.id ?? null, name: rule.name, signalType: rule.signal_type, points: result.points, occurrences: result.occurrences });
  }
  score = Math.round(clamp(score, floor, ceiling));
  const thresholds = object(model.qualification_thresholds ?? model.qualificationThresholds);
  const warm = number(thresholds.warm, 30);
  const hot = number(thresholds.hot, 60);
  const qualified = number(thresholds.qualified, 75);
  const grade = score >= qualified ? "qualified" : score >= hot ? "hot" : score >= warm ? "warm" : "cold";
  return { score, grade, contributions, thresholds: { warm, hot, qualified }, calculatedAt: now.toISOString() };
}

export async function activeModel(client, organizationId) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND status='active' ORDER BY version DESC LIMIT 1`,
    [organizationId],
  );
  return result.rows[0] || null;
}

// Internal, unchecked recalculation — used by system-triggered recalculation
// (Lead create/update, qualification decisions, stage transitions are NOT
// a trigger per the dossier's own explicit list) where the ACTING user may
// not personally hold crm.leads.view_sensitive (an ordinary rep creating a
// Lead should not need that permission just to have it auto-scored). Skips
// gracefully (returns null) when no active model is configured, rather than
// blocking the Lead mutation that triggered it — scoring is enrichment, not
// a hard precondition of the write it rides along with.
export async function recalculateLeadScoreInternal(client, context, leadId, reason = "Lead intelligence recalculation") {
  const model = await activeModel(client, context.organizationId);
  if (!model) return null;
  const leadResult = await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead) return null;
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const rulesResult = await client.query(
    `SELECT * FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 AND model_id=$2 AND status='active' ORDER BY sequence,id`,
    [context.organizationId, model.id],
  );
  const eventsResult = await client.query(
    `SELECT * FROM tenant.crm_lead_behavior_events WHERE organization_id=$1 AND lead_id=$2 AND occurred_at>=now()-interval '5 years' ORDER BY occurred_at DESC`,
    [context.organizationId, leadId],
  );
  const breakdown = calculateLeadScoreBreakdown({ lead, model, rules: rulesResult.rows, events: eventsResult.rows });
  const explanation = {
    model: { id: model.id, name: model.name, version: model.version },
    thresholds: breakdown.thresholds,
    contributions: JSON.stringify(breakdown.contributions),
    reason,
  };
  const contentHash = crmLeadIntelligenceHash({ leadId, score: breakdown.score, grade: breakdown.grade, explanation, calculatedAt: breakdown.calculatedAt });
  await client.query(
    `UPDATE tenant.crm_leads SET score=$1,lead_grade=$2,score_model_id=$3,score_calculated_at=$4,score_explanation=$5,updated_by=$6,updated_at=now() WHERE organization_id=$7 AND id=$8`,
    [breakdown.score, breakdown.grade, model.id, breakdown.calculatedAt, explanation, context.userId, context.organizationId, leadId],
  );
  await client.query(
    `INSERT INTO tenant.crm_lead_score_snapshots(organization_id,company_id,lead_id,model_id,score,grade,contributions,explanation,content_hash,calculated_at,calculated_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
    [context.organizationId, lead.company_id, leadId, model.id, breakdown.score, breakdown.grade, JSON.stringify(breakdown.contributions), explanation, contentHash, breakdown.calculatedAt, context.userId],
  );
  if (number(lead.score) !== breakdown.score) {
    await client.query(
      `INSERT INTO tenant.crm_lead_score_history(organization_id,lead_id,previous_score,new_score,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
      [context.organizationId, leadId, number(lead.score), breakdown.score, reason, context.userId],
    );
  }
  return { leadId, ...breakdown, explanation, contentHash };
}

// Caller-facing wrapper: same permission gate the API surface always had
// (crm.leads.view_sensitive) for an interactive user explicitly requesting
// a recalculation or reacting to a behavior event they themselves logged.
export async function recalculateLeadScore(client, context, leadId, reason = "Lead intelligence recalculation") {
  assertSensitiveLeadIntelligenceAccess(context);
  const result = await recalculateLeadScoreInternal(client, context, leadId, reason);
  if (!result)
    throw new CrmLeadIntelligenceError(409, "No active lead scoring model is configured.", "CRM_LEAD_SCORING_MODEL_MISSING");
  return result;
}

export async function getLeadScoreExplanation(client, context, leadId) {
  assertSensitiveLeadIntelligenceAccess(context);
  const lead = await getScopedLead(client, context, leadId);
  const snapshot = await client.query(
    `SELECT content_hash,calculated_at FROM tenant.crm_lead_score_snapshots
      WHERE organization_id=$1 AND lead_id=$2 ORDER BY calculated_at DESC LIMIT 1`,
    [context.organizationId, leadId],
  );
  return {
    id: lead.id,
    code: lead.code,
    full_name: lead.full_name,
    score: lead.score,
    lead_grade: lead.lead_grade,
    score_calculated_at: lead.score_calculated_at,
    score_explanation: lead.score_explanation,
    content_hash: snapshot.rows[0]?.content_hash ?? null,
    snapshot_at: snapshot.rows[0]?.calculated_at ?? null,
  };
}
