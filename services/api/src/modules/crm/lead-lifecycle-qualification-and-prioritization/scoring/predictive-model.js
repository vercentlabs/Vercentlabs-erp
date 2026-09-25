// F027 Lead scoring — the predictive (statistical) model type. A
// transparent, explainable Naive Bayes classifier trained on the org's own
// crm_leads.qualification_state history (qualified vs unqualified — the
// same terminal decision F006's decideLeadQualification governs), scored
// against a small set of categorical Lead attributes. This is intentionally
// not a black-box/vendor ML call: it mirrors Odoo's Predictive Lead Scoring
// approach (see the "Lead management in top ERPs" benchmark) so every score
// this produces can be explained in terms of "which factor moved it."
//
// calculatePredictiveScoreBreakdown is pure (no I/O), exactly like
// calculateLeadScoreBreakdown in scoring-engine.js, and returns the same
// {score, grade, contributions, thresholds, calculatedAt} shape so
// recalculateLeadScoreInternal's five existing callers need no changes.
import { CrmLeadIntelligenceError, assertScoringConfigPermission, text, number, clamp } from "./shared.js";

export const PREDICTIVE_TRAINING_FIELDS = Object.freeze({
  sourceId: "source_id",
  industry: "industry",
  countryCode: "country_code",
  rating: "rating",
  priority: "priority",
});

const UNSEEN_VALUE = "__unseen__";
const CLASSES = Object.freeze(["qualified", "unqualified"]);

function normalizeFeatureValue(value) {
  const normalized = text(value).toLowerCase();
  return normalized || "unknown";
}

function logOf(probability) {
  return Math.log(Math.max(probability, Number.EPSILON));
}

export function validateTrainingVariables(input) {
  const variables = Array.isArray(input) ? [...new Set(input.map((value) => text(value)))] : [];
  const invalid = variables.filter((key) => !Object.prototype.hasOwnProperty.call(PREDICTIVE_TRAINING_FIELDS, key));
  if (invalid.length)
    throw new CrmLeadIntelligenceError(400, `Unsupported predictive training variable: ${invalid.join(", ")}.`, "CRM_LEAD_SCORING_TRAINING_VARIABLE_INVALID");
  if (!variables.length)
    throw new CrmLeadIntelligenceError(400, "Select at least one training variable for a predictive model.", "CRM_LEAD_SCORING_TRAINING_VARIABLE_REQUIRED");
  return variables;
}

// Trains (or retrains) a predictive model's priors in place. Only a draft
// (never-activated) model may be retrained, matching the rule-based model's
// own "an active model's shape is immutable, create a new version instead"
// convention in model-config.js.
export async function trainPredictiveLeadScoringModel(client, context, modelId) {
  assertScoringConfigPermission(context);
  const modelResult = await client.query(
    `SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, modelId],
  );
  const model = modelResult.rows[0];
  if (!model) throw new CrmLeadIntelligenceError(404, "Scoring model not found.", "CRM_LEAD_SCORING_MODEL_NOT_FOUND");
  if (model.model_type !== "predictive")
    throw new CrmLeadIntelligenceError(409, "Only a predictive model can be trained.", "CRM_LEAD_SCORING_MODEL_NOT_PREDICTIVE");
  if (model.status === "active")
    throw new CrmLeadIntelligenceError(409, "Create a new model version to retrain instead of retraining an active model.", "CRM_LEAD_SCORING_MODEL_ACTIVE_IMMUTABLE");

  const variables = validateTrainingVariables(model.training_variables);
  const columns = variables.map((key) => PREDICTIVE_TRAINING_FIELDS[key]);
  const rows = await client.query(
    `SELECT qualification_state, ${columns.join(",")} FROM tenant.crm_leads
      WHERE organization_id=$1 AND qualification_state IN ('qualified','unqualified')`,
    [context.organizationId],
  );

  const classCounts = { qualified: 0, unqualified: 0 };
  for (const row of rows.rows) classCounts[row.qualification_state] += 1;
  const minimumClassSize = Number(model.minimum_class_size || 40);
  if (classCounts.qualified < minimumClassSize || classCounts.unqualified < minimumClassSize)
    throw new CrmLeadIntelligenceError(
      409,
      `A predictive model needs at least ${minimumClassSize} qualified and ${minimumClassSize} unqualified Leads to train on (found ${classCounts.qualified} qualified, ${classCounts.unqualified} unqualified).`,
      "CRM_LEAD_SCORING_INSUFFICIENT_DATA",
      { qualified: classCounts.qualified, unqualified: classCounts.unqualified, required: minimumClassSize },
    );

  const totalCount = classCounts.qualified + classCounts.unqualified;
  const classPriors = {
    qualified: { probability: classCounts.qualified / totalCount, count: classCounts.qualified },
    unqualified: { probability: classCounts.unqualified / totalCount, count: classCounts.unqualified },
  };

  const priorRows = [];
  for (let index = 0; index < variables.length; index += 1) {
    const featureKey = variables[index];
    const column = columns[index];
    const valuesByClass = { qualified: new Map(), unqualified: new Map() };
    const vocabulary = new Set();
    for (const row of rows.rows) {
      const value = normalizeFeatureValue(row[column]);
      vocabulary.add(value);
      const bucket = valuesByClass[row.qualification_state];
      bucket.set(value, (bucket.get(value) || 0) + 1);
    }
    const vocabularySize = vocabulary.size + 1; // +1 reserves the "__unseen__" bucket
    for (const cls of CLASSES) {
      const denominator = classCounts[cls] + vocabularySize;
      for (const value of vocabulary) {
        const count = valuesByClass[cls].get(value) || 0;
        priorRows.push({ featureKey, value, cls, probability: (count + 1) / denominator, sampleCount: count });
      }
      priorRows.push({ featureKey, value: UNSEEN_VALUE, cls, probability: 1 / denominator, sampleCount: 0 });
    }
  }

  await client.query(`DELETE FROM tenant.crm_lead_scoring_model_priors WHERE organization_id=$1 AND model_id=$2`, [context.organizationId, modelId]);
  for (const prior of priorRows) {
    await client.query(
      `INSERT INTO tenant.crm_lead_scoring_model_priors(organization_id,model_id,feature_key,feature_value,class,probability,sample_count)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [context.organizationId, modelId, prior.featureKey, prior.value, prior.cls, prior.probability, prior.sampleCount],
    );
  }

  const trainingSummary = { qualifiedCount: classCounts.qualified, unqualifiedCount: classCounts.unqualified, variables, trainedAt: new Date().toISOString() };
  const updated = await client.query(
    `UPDATE tenant.crm_lead_scoring_models
        SET class_priors=$3::jsonb,training_summary=$4::jsonb,trained_at=now(),updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, modelId, JSON.stringify(classPriors), JSON.stringify(trainingSummary), context.userId],
  );
  return updated.rows[0];
}

// Pure — mirrors calculateLeadScoreBreakdown's contract exactly. `priors` is
// the full crm_lead_scoring_model_priors row set for this model (loaded once
// by the caller, not per-Lead).
export function calculatePredictiveScoreBreakdown(input = {}) {
  const lead = input.lead || {};
  const model = input.model || {};
  const priors = Array.isArray(input.priors) ? input.priors : [];
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const classPriors = model.class_priors || {};
  const variables = Array.isArray(model.training_variables) ? model.training_variables : [];

  const priorIndex = new Map();
  for (const row of priors) priorIndex.set(`${row.feature_key}:${row.feature_value}:${row.class}`, Number(row.probability));
  const lookup = (featureKey, value, cls) => priorIndex.get(`${featureKey}:${value}:${cls}`) ?? priorIndex.get(`${featureKey}:${UNSEEN_VALUE}:${cls}`) ?? Number.EPSILON;

  const contributions = [];
  const logScore = { qualified: logOf(number(classPriors.qualified?.probability, 0.5)), unqualified: logOf(number(classPriors.unqualified?.probability, 0.5)) };
  for (const featureKey of variables) {
    const column = PREDICTIVE_TRAINING_FIELDS[featureKey];
    if (!column) continue;
    const value = normalizeFeatureValue(lead[column] ?? lead[featureKey]);
    const qualifiedLikelihood = lookup(featureKey, value, "qualified");
    const unqualifiedLikelihood = lookup(featureKey, value, "unqualified");
    logScore.qualified += logOf(qualifiedLikelihood);
    logScore.unqualified += logOf(unqualifiedLikelihood);
    contributions.push({
      ruleId: null,
      name: `${featureKey}: ${value}`,
      signalType: "predictive",
      points: Math.round((logOf(qualifiedLikelihood) - logOf(unqualifiedLikelihood)) * 10),
      occurrences: 1,
    });
  }
  contributions.sort((left, right) => Math.abs(right.points) - Math.abs(left.points));

  const peak = Math.max(logScore.qualified, logScore.unqualified);
  const qualifiedWeight = Math.exp(logScore.qualified - peak);
  const unqualifiedWeight = Math.exp(logScore.unqualified - peak);
  const probabilityQualified = qualifiedWeight / (qualifiedWeight + unqualifiedWeight);

  const floor = number(model.score_floor, 0);
  const ceiling = number(model.score_ceiling, 100);
  const score = Math.round(clamp(probabilityQualified * 100, floor, ceiling));
  const thresholds = model.qualification_thresholds || {};
  const warm = number(thresholds.warm, 30);
  const hot = number(thresholds.hot, 60);
  const qualified = number(thresholds.qualified, 75);
  const grade = score >= qualified ? "qualified" : score >= hot ? "hot" : score >= warm ? "warm" : "cold";
  return { score, grade, contributions, thresholds: { warm, hot, qualified }, calculatedAt: now.toISOString(), probabilityQualified };
}
