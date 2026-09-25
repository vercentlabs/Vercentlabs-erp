import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { recalculateLeadScoreInternal } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/scoring-engine.js";
import { activateLeadScoringModel } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/model-config.js";

// F027 — the deterministic rule score and the ML propensity are separate:
// one active model of each type; the rule model writes score/lead_grade, the
// predictive model writes propensity_*; neither overwrites the other.

const org = "11111111-1111-4111-8111-111111111111";
const leadId = "44444444-4444-4444-8444-444444444444";
const admin = { organizationId: org, userId: "22222222-2222-4222-8222-222222222222", permissions: ["crm.leads.view_sensitive", "crm.settings.manage"], roleSlugs: ["organization_owner"] };
const ruleModel = { id: "rule-model", name: "Rules", version: 2, model_type: "rule_based", base_score: 0, score_floor: -100, score_ceiling: 100, qualification_thresholds: { warm: 30, hot: 60, qualified: 75 } };
const predictiveModel = {
  id: "ml-model", name: "Propensity", version: 1, model_type: "predictive", score_floor: 0, score_ceiling: 100,
  training_variables: ["rating"], class_priors: { qualified: { probability: 0.5 }, unqualified: { probability: 0.5 } },
  qualification_thresholds: { warm: 30, hot: 60, qualified: 75 },
};
const priors = [
  { feature_key: "rating", feature_value: "hot", class: "qualified", probability: 0.8 },
  { feature_key: "rating", feature_value: "hot", class: "unqualified", probability: 0.2 },
];

function client({ rule = ruleModel, predictive = predictiveModel } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_lead_scoring_models WHERE organization_id")) {
        const model = values[1] === "predictive" ? predictive : rule;
        return { rows: model ? [model] : [] };
      }
      if (sql.includes("SELECT * FROM tenant.crm_leads WHERE organization_id")) return { rows: [{ id: leadId, organization_id: org, score: 0, company_id: null, email: "a@example.com", rating: "hot" }] };
      if (sql.includes("FROM tenant.crm_lead_scoring_model_rules")) return { rows: [{ id: "r1", name: "Email", status: "active", signal_type: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 20 }] };
      if (sql.includes("FROM tenant.crm_lead_behavior_events")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_lead_scoring_model_priors")) return { rows: priors };
      if (sql.startsWith("UPDATE tenant.crm_leads SET score=")) { writes.push({ kind: "score", values }); return { rows: [] }; }
      if (sql.startsWith("UPDATE tenant.crm_leads SET propensity_score=")) { writes.push({ kind: "propensity", values }); return { rows: [] }; }
      if (sql.includes("INSERT INTO tenant.crm_lead_score_snapshots")) { writes.push({ kind: "snapshot", values }); return { rows: [] }; }
      if (sql.includes("INSERT INTO tenant.crm_lead_score_history")) { writes.push({ kind: "history", values }); return { rows: [] }; }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F027: with both models active, the rule score stays points-based and the propensity is written separately", async () => {
  const c = client();
  const result = await recalculateLeadScoreInternal(c, admin, leadId, "test");
  assert.equal(result.score, 20, "the transparent score is the rule points, not a probability");
  assert.equal(result.propensity.score, 80, "the propensity is the model's probability of qualifying");
  const scoreWrite = c.writes.find((w) => w.kind === "score");
  const propensityWrite = c.writes.find((w) => w.kind === "propensity");
  assert.equal(scoreWrite.values[0], 20);
  assert.equal(scoreWrite.values[2], "rule-model");
  assert.equal(propensityWrite.values[0], 80);
  assert.equal(propensityWrite.values[2], "ml-model");
  assert.equal(c.writes.filter((w) => w.kind === "snapshot").length, 2, "each model keeps its own explainable snapshot");
});

test("F027: a predictive model alone never touches the rule score", async () => {
  const c = client({ rule: null });
  const result = await recalculateLeadScoreInternal(c, admin, leadId, "test");
  assert.equal(result, null, "no rule score to report");
  assert.ok(c.writes.some((w) => w.kind === "propensity"));
  assert.ok(!c.writes.some((w) => w.kind === "score" || w.kind === "history"));
});

test("F027: activating a model retires only the active model of the same type", async () => {
  const calls = [];
  const c = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT * FROM tenant.crm_lead_scoring_models")) return { rows: [{ ...predictiveModel, status: "draft", trained_at: new Date() }] };
      if (sql.includes("SET status='active'")) return { rows: [{ ...predictiveModel, status: "active" }] };
      return { rows: [{ id: "job", count: 0 }] };
    },
  };
  await activateLeadScoringModel(c, admin, "ml-model").catch(() => undefined);
  const retire = calls.find((call) => call.sql.includes("SET status='retired'"));
  assert.match(retire.sql, /AND model_type=\$4/);
  assert.equal(retire.values[3], "predictive");
});

test("F027: the database allows one active model per type, and leads carry separate propensity columns", () => {
  const migration = readFileSync(new URL("../../../database/tenant/migrations/174_f027_lead_propensity_separate_from_score.sql", import.meta.url), "utf8");
  assert.match(migration, /ON tenant\.crm_lead_scoring_models\(organization_id, model_type\)\s+WHERE status='active'/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS propensity_score smallint/);
});
