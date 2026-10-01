// F027 Lead scoring — scoring model/rule configuration (crm_lead_scoring_
// models / crm_lead_scoring_model_rules). New for CRM vNext Prompt 4: this
// is the Settings UX's backing surface (CRM Settings > Lead management >
// Lead scoring), replacing the legacy tenant.crm_scoring_rules generic CRUD
// resource that was, until this prompt, silently governing the real
// crm_leads.score column while this richer model sat unused for that
// purpose. One model of each type may be status='active' per org
// (crm_lead_scoring_models_one_active_per_type_idx, F027): the rule model
// owns the transparent score, the predictive model the separate propensity.
// Activating a new one retires the previous of the same type and enqueues a
// bulk recalculation job so existing Leads don't carry a stale value.
import { CrmLeadIntelligenceError, assertSensitiveLeadIntelligenceAccess, assertScoringConfigPermission, text, number } from "./shared.js";
import { enqueueLeadScoreRecalcJob } from "./bulk-recalc.js";
import { validateTrainingVariables, trainPredictiveLeadScoringModel } from "./predictive-model.js";

const assertConfigPermission = assertScoringConfigPermission;
export const trainLeadScoringModel = trainPredictiveLeadScoringModel;

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

function normalizeModelInput(input, { create = false, modelType = "rule_based" } = {}) {
  const result = {};
  if (create || Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = text(input.name);
    if (!name || name.length > 160) throw new CrmLeadIntelligenceError(400, "Model name must contain 1 to 160 characters.", "CRM_LEAD_SCORING_MODEL_INVALID");
    result.name = name;
  }
  if (create || Object.prototype.hasOwnProperty.call(input, "baseScore")) result.baseScore = Math.trunc(number(input.baseScore, 0));
  // A predictive model's score is a 0-100 probability, not an
  // accumulated-points total, so its default band differs from the
  // rule-based default (-100..100).
  if (create || Object.prototype.hasOwnProperty.call(input, "scoreFloor")) result.scoreFloor = Math.trunc(number(input.scoreFloor, modelType === "predictive" ? 0 : -100));
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
  if (modelType === "predictive" && (create || Object.prototype.hasOwnProperty.call(input, "trainingVariables")))
    result.trainingVariables = validateTrainingVariables(input.trainingVariables);
  if (modelType === "predictive" && Object.prototype.hasOwnProperty.call(input, "minimumClassSize")) {
    const size = Math.trunc(number(input.minimumClassSize, 40));
    if (size < 10 || size > 5000) throw new CrmLeadIntelligenceError(400, "Minimum class size must be between 10 and 5,000.", "CRM_LEAD_SCORING_MODEL_INVALID");
    result.minimumClassSize = size;
  }
  return result;
}

export async function createLeadScoringModel(client, context, input = {}) {
  assertConfigPermission(context);
  const modelType = ["rule_based", "predictive"].includes(text(input.modelType)) ? text(input.modelType) : "rule_based";
  const value = normalizeModelInput(input, { create: true, modelType });
  const nextVersion = await client.query(
    `SELECT COALESCE(max(version),0)+1 AS version FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND name=$2`,
    [context.organizationId, value.name],
  );
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_scoring_models(organization_id,name,version,status,model_type,base_score,score_floor,score_ceiling,decay_half_life_days,qualification_thresholds,training_variables,minimum_class_size,created_by,updated_by)
     VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$12) RETURNING *`,
    [
      context.organizationId,
      value.name,
      nextVersion.rows[0].version,
      modelType,
      value.baseScore,
      value.scoreFloor,
      value.scoreCeiling,
      value.decayHalfLifeDays,
      JSON.stringify(value.qualificationThresholds),
      JSON.stringify(value.trainingVariables || []),
      value.minimumClassSize ?? 40,
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
  const modelType = existing.rows[0].model_type;
  const value = normalizeModelInput(input, { modelType });
  const fields = Object.keys(value);
  if (!fields.length) throw new CrmLeadIntelligenceError(400, "Provide a model field to update.", "CRM_LEAD_SCORING_MODEL_EMPTY_PATCH");
  const columns = { name: "name", baseScore: "base_score", scoreFloor: "score_floor", scoreCeiling: "score_ceiling", decayHalfLifeDays: "decay_half_life_days", qualificationThresholds: "qualification_thresholds", trainingVariables: "training_variables", minimumClassSize: "minimum_class_size" };
  const jsonFields = new Set(["qualificationThresholds", "trainingVariables"]);
  const values = [context.organizationId, id];
  const sets = fields.map((field) => {
    values.push(jsonFields.has(field) ? JSON.stringify(value[field]) : value[field]);
    return `${columns[field]}=$${values.length}${jsonFields.has(field) ? "::jsonb" : ""}`;
  });
  // Changing which variables a predictive model trains on invalidates any
  // priors already computed for it — force a retrain before it can activate.
  const clearsTraining = modelType === "predictive" && fields.includes("trainingVariables");
  values.push(context.userId);
  const result = await client.query(
    `UPDATE tenant.crm_lead_scoring_models SET ${sets.join(",")},updated_by=$${values.length},updated_at=now()${clearsTraining ? ",trained_at=NULL,class_priors='{}'::jsonb,training_summary='{}'::jsonb" : ""} WHERE organization_id=$1 AND id=$2 RETURNING *`,
    values,
  );
  if (clearsTraining) await client.query(`DELETE FROM tenant.crm_lead_scoring_model_priors WHERE organization_id=$1 AND model_id=$2`, [context.organizationId, id]);
  return result.rows[0];
}

// Activating a new model version retires the previously active model OF
// THE SAME TYPE (F027: a rule model and a predictive model may both be
// active — one owns the score, the other the separate propensity; the DB's
// per-type partial unique index is the backstop) and enqueues a bulk recalculation job so every existing active
// Lead is re-scored under the new model rather than carrying a stale
// score/model_id until it happens to be touched by an unrelated trigger.
export async function activateLeadScoringModel(client, context, id) {
  assertConfigPermission(context);
  const model = await client.query(`SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND id=$2`, [context.organizationId, id]);
  if (!model.rows[0]) throw new CrmLeadIntelligenceError(404, "Scoring model not found.", "CRM_LEAD_SCORING_MODEL_NOT_FOUND");
  if (model.rows[0].status === "active") return { model: model.rows[0], recalcJob: null };
  if (model.rows[0].model_type === "predictive") {
    if (!model.rows[0].trained_at)
      throw new CrmLeadIntelligenceError(409, "Train this predictive model before it can be activated.", "CRM_LEAD_SCORING_MODEL_NOT_TRAINED");
  } else {
    const ruleCount = await client.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_scoring_model_rules WHERE organization_id=$1 AND model_id=$2 AND status='active'`, [context.organizationId, id]);
    if (!Number(ruleCount.rows[0]?.count))
      throw new CrmLeadIntelligenceError(409, "A scoring model needs at least one active rule before it can be activated.", "CRM_LEAD_SCORING_MODEL_NO_RULES");
  }
  await client.query(`UPDATE tenant.crm_lead_scoring_models SET status='retired',updated_by=$3,updated_at=now() WHERE organization_id=$1 AND status='active' AND id<>$2 AND model_type=$4`, [context.organizationId, id, context.userId, model.rows[0].model_type]);
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
  const model = await client.query(`SELECT id,status,model_type FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND id=$2`, [context.organizationId, modelId]);
  if (!model.rows[0]) throw new CrmLeadIntelligenceError(404, "Scoring model not found.", "CRM_LEAD_SCORING_MODEL_NOT_FOUND");
  if (model.rows[0].model_type !== "rule_based")
    throw new CrmLeadIntelligenceError(409, "A predictive model is trained, not configured with rules.", "CRM_LEAD_SCORING_MODEL_NOT_RULE_BASED");
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
