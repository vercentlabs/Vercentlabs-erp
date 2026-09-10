// F027 Lead scoring — scoring model/rule configuration (crm_lead_scoring_
// models / crm_lead_scoring_model_rules). New for CRM vNext Prompt 4: this
// is the Settings UX's backing surface (CRM Settings > Lead management >
// Lead scoring), replacing the legacy tenant.crm_scoring_rules generic CRUD
// resource that was, until this prompt, silently governing the real
// crm_leads.score column while this richer model sat unused for that
// purpose. Only one model may be status='active' per org
// (crm_lead_scoring_models_one_active_idx) — activating a new one
// deactivates the previous and enqueues a bulk recalculation job so
// existing Leads don't carry a stale score/model_id indefinitely.
import { CrmLeadIntelligenceError, assertSensitiveLeadIntelligenceAccess, text, number } from "./shared.js";
import { enqueueLeadScoreRecalcJob } from "./bulk-recalc.js";

function assertConfigPermission(context) {
  if (!context.permissions?.includes("crm.settings.manage") && !context.roleSlugs?.includes("organization_owner"))
    throw new CrmLeadIntelligenceError(403, "You do not have permission to configure Lead scoring.", "CRM_LEAD_SCORING_CONFIG_FORBIDDEN");
}

export async function listLeadScoringModels(client, context) {
  assertSensitiveLeadIntelligenceAccess(context);
  const models = await client.query(
    `SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 ORDER BY status='active' DESC,version DESC`,
    [context.organizationId],
  );
  const rules = await client.query(
    `SELECT * FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 ORDER BY model_id,sequence,id`,
    [context.organizationId],
  );
  return models.rows.map((model) => ({
    ...model,
    rules: rules.rows.filter((rule) => rule.model_id === model.id),
  }));
}

function normalizeModelInput(input, { create = false } = {}) {
  const result = {};
  if (create || Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = text(input.name);
    if (!name || name.length > 160) throw new CrmLeadIntelligenceError(400, "Model name must contain 1 to 160 characters.", "CRM_LEAD_SCORING_MODEL_INVALID");
    result.name = name;
  }
  if (create || Object.prototype.hasOwnProperty.call(input, "baseScore")) result.baseScore = Math.trunc(number(input.baseScore, 0));
  if (create || Object.prototype.hasOwnProperty.call(input, "scoreFloor")) result.scoreFloor = Math.trunc(number(input.scoreFloor, -100));
  if (create || Object.prototype.hasOwnProperty.call(input, "scoreCeiling")) result.scoreCeiling = Math.trunc(number(input.scoreCeiling, 100));
  if (result.scoreFloor !== undefined && result.scoreCeiling !== undefined && result.scoreFloor >= result.scoreCeiling)
    throw new CrmLeadIntelligenceError(400, "Score floor must be less than score ceiling.", "CRM_LEAD_SCORING_MODEL_INVALID");
  if (create || Object.prototype.hasOwnProperty.call(input, "decayHalfLifeDays")) {
    const days = Math.trunc(number(input.decayHalfLifeDays, 30));
    if (days < 1 || days > 3650) throw new CrmLeadIntelligenceError(400, "Decay half-life must be between 1 and 3650 days.", "CRM_LEAD_SCORING_MODEL_INVALID");
    result.decayHalfLifeDays = days;
  }
  if (create || Object.prototype.hasOwnProperty.call(input, "qualificationThresholds")) {
    const thresholds = input.qualificationThresholds && typeof input.qualificationThresholds === "object" ? input.qualificationThresholds : {};
    const warm = number(thresholds.warm, 30);
    const hot = number(thresholds.hot, 60);
    const qualified = number(thresholds.qualified, 75);
    if (!(warm < hot && hot < qualified))
      throw new CrmLeadIntelligenceError(400, "Segment thresholds must increase: warm < hot < qualified.", "CRM_LEAD_SCORING_MODEL_INVALID");
    result.qualificationThresholds = { warm, hot, qualified };
  }
  return result;
}

export async function createLeadScoringModel(client, context, input = {}) {
  assertConfigPermission(context);
  const value = normalizeModelInput(input, { create: true });
  const nextVersion = await client.query(
    `SELECT COALESCE(max(version),0)+1 AS version FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND name=$2`,
    [context.organizationId, value.name],
  );
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_scoring_models(organization_id,name,version,status,base_score,score_floor,score_ceiling,decay_half_life_days,qualification_thresholds,created_by,updated_by)
     VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8::jsonb,$9,$9) RETURNING *`,
    [
      context.organizationId,
      value.name,
      nextVersion.rows[0].version,
      value.baseScore,
      value.scoreFloor,
      value.scoreCeiling,
      value.decayHalfLifeDays,
      JSON.stringify(value.qualificationThresholds),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function updateLeadScoringModel(client, context, id, input = {}) {
  assertConfigPermission(context);
  const existing = await client.query(`SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND id=$2`, [context.organizationId, id]);
  if (!existing.rows[0]) throw new CrmLeadIntelligenceError(404, "Scoring model not found.", "CRM_LEAD_SCORING_MODEL_NOT_FOUND");
  if (existing.rows[0].status === "active")
    throw new CrmLeadIntelligenceError(409, "An active model's rules would silently reinterpret historical scores — create a new version instead of editing it in place.", "CRM_LEAD_SCORING_MODEL_ACTIVE_IMMUTABLE");
  const value = normalizeModelInput(input);
  const fields = Object.keys(value);
  if (!fields.length) throw new CrmLeadIntelligenceError(400, "Provide a model field to update.", "CRM_LEAD_SCORING_MODEL_EMPTY_PATCH");
  const columns = { name: "name", baseScore: "base_score", scoreFloor: "score_floor", scoreCeiling: "score_ceiling", decayHalfLifeDays: "decay_half_life_days", qualificationThresholds: "qualification_thresholds" };
  const values = [context.organizationId, id];
  const sets = fields.map((field) => {
    values.push(field === "qualificationThresholds" ? JSON.stringify(value[field]) : value[field]);
    return `${columns[field]}=$${values.length}${field === "qualificationThresholds" ? "::jsonb" : ""}`;
  });
  values.push(context.userId);
  const result = await client.query(
    `UPDATE tenant.crm_lead_scoring_models SET ${sets.join(",")},updated_by=$${values.length},updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    values,
  );
  return result.rows[0];
}

// Activating a new model version deactivates the previously active one
// (never two active models — the DB's own partial unique index is the
// backstop) and enqueues a bulk recalculation job so every existing active
// Lead is re-scored under the new model rather than carrying a stale
// score/model_id until it happens to be touched by an unrelated trigger.
export async function activateLeadScoringModel(client, context, id) {
  assertConfigPermission(context);
  const model = await client.query(`SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND id=$2`, [context.organizationId, id]);
  if (!model.rows[0]) throw new CrmLeadIntelligenceError(404, "Scoring model not found.", "CRM_LEAD_SCORING_MODEL_NOT_FOUND");
  if (model.rows[0].status === "active") return { model: model.rows[0], recalcJob: null };
  const ruleCount = await client.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 AND model_id=$2 AND status='active'`, [context.organizationId, id]);
  if (!Number(ruleCount.rows[0]?.count))
    throw new CrmLeadIntelligenceError(409, "A scoring model needs at least one active rule before it can be activated.", "CRM_LEAD_SCORING_MODEL_NO_RULES");
  await client.query(`UPDATE tenant.crm_lead_scoring_models SET status='retired',updated_by=$3,updated_at=now() WHERE organization_id=$1 AND status='active' AND id<>$2`, [context.organizationId, id, context.userId]);
  const activated = await client.query(
    `UPDATE tenant.crm_lead_scoring_models SET status='active',activated_at=now(),updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, id, context.userId],
  );
  const recalcJob = await enqueueLeadScoreRecalcJob(client, context, id);
  return { model: activated.rows[0], recalcJob };
}

function normalizeRuleInput(input, { create = false } = {}) {
  const result = {};
  if (create || Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = text(input.name);
    if (!name || name.length > 160) throw new CrmLeadIntelligenceError(400, "Rule name must contain 1 to 160 characters.", "CRM_LEAD_SCORING_RULE_INVALID");
    result.name = name;
  }
  if (create || Object.prototype.hasOwnProperty.call(input, "signalType")) {
    const signalType = text(input.signalType);
    if (!["demographic", "firmographic", "behavioral", "negative"].includes(signalType))
      throw new CrmLeadIntelligenceError(400, "Signal type must be demographic, firmographic, behavioral or negative.", "CRM_LEAD_SCORING_RULE_INVALID");
    result.signalType = signalType;
  }
  if (create || Object.prototype.hasOwnProperty.call(input, "predicate")) {
    if (!input.predicate || typeof input.predicate !== "object") throw new CrmLeadIntelligenceError(400, "Provide a rule predicate.", "CRM_LEAD_SCORING_RULE_INVALID");
    result.predicate = input.predicate;
  }
  if (create || Object.prototype.hasOwnProperty.call(input, "points")) {
    const points = Math.trunc(number(input.points, 0));
    if (points < -1000 || points > 1000) throw new CrmLeadIntelligenceError(400, "Points must be between -1000 and 1000.", "CRM_LEAD_SCORING_RULE_INVALID");
    result.points = points;
  }
  if (Object.prototype.hasOwnProperty.call(input, "maximumOccurrences"))
    result.maximumOccurrences = input.maximumOccurrences === null ? null : Math.max(1, Math.trunc(number(input.maximumOccurrences, 1)));
  if (Object.prototype.hasOwnProperty.call(input, "decayEnabled")) result.decayEnabled = Boolean(input.decayEnabled);
  if (Object.prototype.hasOwnProperty.call(input, "sequence")) result.sequence = Math.trunc(number(input.sequence, 100));
  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    if (!["active", "inactive"].includes(text(input.status))) throw new CrmLeadIntelligenceError(400, "Rule status is invalid.", "CRM_LEAD_SCORING_RULE_INVALID");
    result.status = text(input.status);
  }
  return result;
}

export async function createLeadScoringModelRule(client, context, modelId, input = {}) {
  assertConfigPermission(context);
  const model = await client.query(`SELECT id,status FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND id=$2`, [context.organizationId, modelId]);
  if (!model.rows[0]) throw new CrmLeadIntelligenceError(404, "Scoring model not found.", "CRM_LEAD_SCORING_MODEL_NOT_FOUND");
  if (model.rows[0].status === "active")
    throw new CrmLeadIntelligenceError(409, "Create a new model version to change rules instead of editing an active model.", "CRM_LEAD_SCORING_MODEL_ACTIVE_IMMUTABLE");
  const value = normalizeRuleInput(input, { create: true });
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_scoring_model_rules(organization_id,model_id,name,sequence,signal_type,predicate,points,maximum_occurrences,decay_enabled,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$10) RETURNING *`,
    [
      context.organizationId,
      modelId,
      value.name,
      value.sequence ?? 100,
      value.signalType,
      JSON.stringify(value.predicate),
      value.points,
      value.maximumOccurrences ?? null,
      value.decayEnabled ?? false,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function setLeadScoringModelRuleStatus(client, context, modelId, ruleId, status) {
  assertConfigPermission(context);
  if (!["active", "inactive"].includes(status)) throw new CrmLeadIntelligenceError(400, "Rule status is invalid.", "CRM_LEAD_SCORING_RULE_INVALID");
  const model = await client.query(`SELECT status FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND id=$2`, [context.organizationId, modelId]);
  if (model.rows[0]?.status === "active")
    throw new CrmLeadIntelligenceError(409, "Create a new model version to change rules instead of editing an active model.", "CRM_LEAD_SCORING_MODEL_ACTIVE_IMMUTABLE");
  const result = await client.query(
    `UPDATE tenant.crm_lead_scoring_model_rules SET status=$4,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND model_id=$2 AND id=$3 RETURNING *`,
    [context.organizationId, modelId, ruleId, status, context.userId],
  );
  if (!result.rows[0]) throw new CrmLeadIntelligenceError(404, "Scoring rule not found.", "CRM_LEAD_SCORING_RULE_NOT_FOUND");
  return result.rows[0];
}
