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
import { calculatePredictiveScoreBreakdown } from "./predictive-model.js";

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

// F027 — a transparent rule model and an ML propensity model are separate:
// at most one of EACH type is active (crm_lead_scoring_models_one_active_per_
// type_idx). The rule model owns crm_leads.score/lead_grade; the predictive
// model owns crm_leads.propensity_*. Neither ever overwrites the other.
export async function activeModel(client, organizationId, modelType = "rule_based") {
  const result = await client.query(
    `SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND status='active' AND model_type=$2 ORDER BY version DESC LIMIT 1`,
    [organizationId, modelType],
  );
  return result.rows[0] || null;
}

// Internal, unchecked recalculation — used by system-triggered recalculation
// (Lead create/update, qualification decisions, stage transitions are NOT
// a trigger per the dossier's own explicit list) where the ACTING user may
// not personally hold crm.leads.view_sensitive (an ordinary rep creating a
// Lead should not need that permission just to have it auto-scored). Skips
// gracefully when no active model is configured, rather than blocking the
// Lead mutation that triggered it — scoring is enrichment, not a hard
// precondition of the write it rides along with. Returns the rule-score
// breakdown (null when no rule model is active) with `propensity` attached
// when a predictive model is active.
export async function recalculateLeadScoreInternal(client, context, leadId, reason = "Lead intelligence recalculation") {
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const ruleModel = await activeModel(client, context.organizationId, "rule_based");
  const predictiveModel = await activeModel(client, context.organizationId, "predictive");
  if (!ruleModel && !predictiveModel) return null;
  const leadResult = await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead) return null;

  let ruleResult = null;
  if (ruleModel) {
    const rulesResult = await client.query(
      `SELECT * FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 AND model_id=$2 AND status='active' ORDER BY sequence,id`,
      [context.organizationId, ruleModel.id],
    );
    const eventsResult = await client.query(
      `SELECT * FROM tenant.crm_lead_behavior_events WHERE organization_id=$1 AND lead_id=$2 AND occurred_at>=now()-interval '5 years' ORDER BY occurred_at DESC`,
      [context.organizationId, leadId],
    );
    const breakdown = calculateLeadScoreBreakdown({ lead, model: ruleModel, rules: rulesResult.rows, events: eventsResult.rows });
    const snapshot = await persistSnapshot(client, context, lead, ruleModel, breakdown, reason);
    await client.query(
      `UPDATE tenant.crm_leads SET score=$1,lead_grade=$2,score_model_id=$3,score_calculated_at=$4,score_explanation=$5,updated_by=$6,updated_at=now() WHERE organization_id=$7 AND id=$8`,
      [breakdown.score, breakdown.grade, ruleModel.id, breakdown.calculatedAt, snapshot.explanation, context.userId, context.organizationId, leadId],
    );
    if (number(lead.score) !== breakdown.score) {
      await client.query(
        `INSERT INTO tenant.crm_lead_score_history(organization_id,lead_id,previous_score,new_score,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [context.organizationId, leadId, number(lead.score), breakdown.score, reason, context.userId],
      );
    }
    ruleResult = { leadId, ...breakdown, explanation: snapshot.explanation, contentHash: snapshot.contentHash };
  }

  let propensity = null;
  if (predictiveModel) {
    const priorsResult = await client.query(
      `SELECT feature_key,feature_value,class,probability FROM tenant.crm_lead_scoring_model_priors WHERE organization_id=$1 AND model_id=$2`,
      [context.organizationId, predictiveModel.id],
    );
    const breakdown = calculatePredictiveScoreBreakdown({ lead, model: predictiveModel, priors: priorsResult.rows });
    const snapshot = await persistSnapshot(client, context, lead, predictiveModel, breakdown, reason);
    await client.query(
      `UPDATE tenant.crm_leads SET propensity_score=$1,propensity_grade=$2,propensity_model_id=$3,propensity_calculated_at=$4,propensity_explanation=$5 WHERE organization_id=$6 AND id=$7`,
      [breakdown.score, breakdown.grade, predictiveModel.id, breakdown.calculatedAt, snapshot.explanation, context.organizationId, leadId],
    );
    propensity = { score: breakdown.score, grade: breakdown.grade, contributions: breakdown.contributions, calculatedAt: breakdown.calculatedAt, explanation: snapshot.explanation };
  }

  if (!ruleResult) return null;
  return propensity ? { ...ruleResult, propensity } : ruleResult;
}

async function persistSnapshot(client, context, lead, model, breakdown, reason) {
  const explanation = {
    model: { id: model.id, name: model.name, version: model.version, type: model.model_type },
    thresholds: breakdown.thresholds,
    contributions: JSON.stringify(breakdown.contributions),
    reason,
  };
  const contentHash = crmLeadIntelligenceHash({ leadId: lead.id, score: breakdown.score, grade: breakdown.grade, explanation, calculatedAt: breakdown.calculatedAt });
  await client.query(
    `INSERT INTO tenant.crm_lead_score_snapshots(organization_id,company_id,lead_id,model_id,score,grade,contributions,explanation,content_hash,calculated_at,calculated_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
    [context.organizationId, lead.company_id, lead.id, model.id, breakdown.score, breakdown.grade, JSON.stringify(breakdown.contributions), explanation, contentHash, breakdown.calculatedAt, context.userId],
  );
  return { explanation, contentHash };
}

// Caller-facing wrapper: same permission gate the API surface always had
// (crm.leads.view_sensitive) for an interactive user explicitly requesting
// a recalculation or reacting to a behavior event they themselves logged.
export async function recalculateLeadScore(client, context, leadId, reason = "Lead intelligence recalculation") {
  assertSensitiveLeadIntelligenceAccess(context);
  const result = await recalculateLeadScoreInternal(client, context, leadId, reason);
  if (result) return result;
  // Only a predictive model is active: the propensity was refreshed; the
  // rule score is absent rather than faked.
  if (await activeModel(client, context.organizationId, "predictive")) {
    const lead = await getScopedLead(client, context, leadId);
    return { leadId, score: null, grade: null, contributions: [], propensity: { score: lead.propensity_score, grade: lead.propensity_grade, calculatedAt: lead.propensity_calculated_at, explanation: lead.propensity_explanation } };
  }
  throw new CrmLeadIntelligenceError(409, "No active lead scoring model is configured.", "CRM_LEAD_SCORING_MODEL_MISSING");
}

export async function getLeadScoreExplanation(client, context, leadId) {
  assertSensitiveLeadIntelligenceAccess(context);
  const lead = await getScopedLead(client, context, leadId);
  const snapshot = await client.query(
    `SELECT content_hash,calculated_at FROM tenant.crm_lead_score_snapshots
      WHERE organization_id=$1 AND lead_id=$2 AND model_id IS NOT DISTINCT FROM $3 ORDER BY calculated_at DESC LIMIT 1`,
    [context.organizationId, leadId, lead.score_model_id ?? null],
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
    // F027 — the ML propensity, kept separate from the rule score above.
    propensity_score: lead.propensity_score ?? null,
    propensity_grade: lead.propensity_grade ?? null,
    propensity_calculated_at: lead.propensity_calculated_at ?? null,
    propensity_explanation: lead.propensity_explanation ?? null,
  };
}
