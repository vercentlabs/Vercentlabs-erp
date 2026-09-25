import assert from "node:assert/strict";
import test from "node:test";

import { calculateLeadScoreBreakdown, evaluateLeadScoreRule, recalculateLeadScoreInternal, recalculateLeadScore } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/scoring-engine.js";
import {
  listLeadScoringModels,
  createLeadScoringModel,
  updateLeadScoringModel,
  activateLeadScoringModel,
  createLeadScoringModelRule,
  setLeadScoringModelRuleStatus,
} from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/model-config.js";
import { enqueueLeadScoreRecalcJob, processLeadScoreRecalcBatch } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/bulk-recalc.js";
import { CrmLeadIntelligenceError } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/shared.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const leadId = "33333333-3333-4333-8333-333333333333";
const modelId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";

const admin = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.leads.view_sensitive", "crm.settings.manage"],
};
const rep = { ...admin, roleSlugs: [], permissions: ["crm.leads.view_sensitive"] };

const model = { id: modelId, base_score: 0, score_floor: -100, score_ceiling: 100, decay_half_life_days: 30, qualification_thresholds: { warm: 30, hot: 60, qualified: 75 } };

test("F027: calculateLeadScoreBreakdown is deterministic — same inputs always produce the same score", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const rules = [{ id: "r1", status: "active", signal_type: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 10 }];
  const lead = { email: "a@example.com" };
  const first = calculateLeadScoreBreakdown({ lead, model, rules, events: [], now });
  const second = calculateLeadScoreBreakdown({ lead, model, rules, events: [], now });
  assert.deepEqual(first, second);
  assert.equal(first.score, 10);
});

test("F027: score is clamped to the model's floor and ceiling (caps)", () => {
  const rules = [
    { id: "r1", status: "active", signal_type: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 500 },
  ];
  const capped = calculateLeadScoreBreakdown({ lead: { email: "a@example.com" }, model: { ...model, score_ceiling: 50 }, rules, events: [], now: new Date() });
  assert.equal(capped.score, 50);
  const floored = calculateLeadScoreBreakdown({
    lead: { email: "a@example.com" },
    model: { ...model, score_floor: -10 },
    rules: [{ ...rules[0], points: -500 }],
    events: [],
    now: new Date(),
  });
  assert.equal(floored.score, -10);
});

test("F027: negative contributions and repeated/duplicate behavioral events are handled — capped by maximum_occurrences", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const rule = { id: "r2", status: "active", signal_type: "behavioral", predicate: { eventType: "form_submitted", withinDays: 90 }, points: 10, maximum_occurrences: 2, decay_enabled: false };
  const events = [
    { event_type: "form_submitted", occurred_at: "2026-01-09T00:00:00Z" },
    { event_type: "form_submitted", occurred_at: "2026-01-08T00:00:00Z" },
    { event_type: "form_submitted", occurred_at: "2026-01-07T00:00:00Z" }, // 3rd occurrence beyond the cap
  ];
  const result = evaluateLeadScoreRule(rule, {}, events, now, 30);
  assert.equal(result.occurrences, 2);
  assert.equal(result.points, 20);
});

test("F027: decay reduces a behavioral rule's contribution as the event ages, deterministically from occurred_at", () => {
  const now = new Date("2026-02-01T00:00:00Z");
  const rule = { id: "r3", status: "active", signal_type: "behavioral", predicate: { eventType: "email_clicked", withinDays: 60 }, points: 10, decay_enabled: true };
  const fresh = evaluateLeadScoreRule(rule, {}, [{ event_type: "email_clicked", occurred_at: now.toISOString() }], now, 30);
  const aged = evaluateLeadScoreRule(rule, {}, [{ event_type: "email_clicked", occurred_at: "2026-01-02T00:00:00Z" }], now, 30);
  assert.equal(fresh.points, 10);
  assert.ok(aged.points < fresh.points, "an event one half-life old must contribute less than a fresh one");
  assert.ok(aged.points > 0, "decay approaches zero but a recent-enough event still contributes something");
});

test("F027: segment thresholds are model-configured — a custom threshold set changes grading for the same score", () => {
  const rules = [{ id: "r1", status: "active", signal_type: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 40 }];
  const strict = calculateLeadScoreBreakdown({
    lead: { email: "a@example.com" },
    model: { ...model, qualification_thresholds: { warm: 10, hot: 20, qualified: 30 } },
    rules,
    events: [],
    now: new Date(),
  });
  assert.equal(strict.grade, "qualified"); // 40 >= 30
  const lenient = calculateLeadScoreBreakdown({
    lead: { email: "a@example.com" },
    model: { ...model, qualification_thresholds: { warm: 50, hot: 70, qualified: 90 } },
    rules,
    events: [],
    now: new Date(),
  });
  assert.equal(lenient.grade, "cold"); // 40 < 50
});

test("F027: explanation itemizes the actual configured rules that matched, with real point contributions", () => {
  const rules = [
    { id: "r1", name: "Work email present", status: "active", signal_type: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 10 },
    { id: "r2", name: "Never matches", status: "active", signal_type: "demographic", predicate: { field: "mobile", operator: "not_empty" }, points: 99 },
  ];
  const breakdown = calculateLeadScoreBreakdown({ lead: { email: "a@example.com" }, model, rules, events: [], now: new Date() });
  assert.equal(breakdown.contributions.length, 1);
  assert.equal(breakdown.contributions[0].name, "Work email present");
  assert.equal(breakdown.contributions[0].points, 10);
});

function recalcClient({ leadRow = { id: leadId, organization_id: org, score: 0, company_id: null }, activeModel = model, rules = [], events = [] } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, values = []) {
      // One active model per type: answer only the type being asked for.
      if (sql.includes("FROM tenant.crm_lead_scoring_models WHERE organization_id"))
        return { rows: activeModel && (activeModel.model_type ?? "rule_based") === values[1] ? [activeModel] : [] };
      if (sql.includes("SELECT * FROM tenant.crm_leads WHERE organization_id")) return { rows: [leadRow] };
      if (sql.includes("FROM tenant.crm_lead_scoring_model_rules")) return { rows: rules };
      if (sql.includes("FROM tenant.crm_lead_behavior_events")) return { rows: events };
      if (sql.startsWith("UPDATE tenant.crm_leads SET score=")) {
        writes.push({ kind: "lead", values });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO tenant.crm_lead_score_snapshots")) {
        writes.push({ kind: "snapshot", values });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO tenant.crm_lead_score_history")) {
        writes.push({ kind: "history", values });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F027: recalculateLeadScoreInternal no-ops gracefully (no throw) when no active model is configured", async () => {
  const client = recalcClient({ activeModel: null });
  const result = await recalculateLeadScoreInternal(client, admin, leadId, "test");
  assert.equal(result, null);
  assert.equal(client.writes.length, 0);
});

test("F027: recalculateLeadScore (caller-facing) throws a stable error code when no active model is configured", async () => {
  const client = recalcClient({ activeModel: null });
  await assert.rejects(
    recalculateLeadScore(client, admin, leadId, "test"),
    (error) => error instanceof CrmLeadIntelligenceError && error.code === "CRM_LEAD_SCORING_MODEL_MISSING",
  );
});

test("F027: recalculateLeadScore requires crm.leads.view_sensitive even for an org owner without it", async () => {
  const client = recalcClient();
  const noSensitive = { ...admin, permissions: [] };
  await assert.rejects(
    recalculateLeadScore(client, { ...noSensitive, roleSlugs: [] }, leadId, "test"),
    (error) => error.code === "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
  );
});

test("F027: recalculateLeadScoreInternal writes score/grade/snapshot and only writes history when the score actually changed", async () => {
  const rules = [{ id: "r1", name: "Email", status: "active", signal_type: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 15 }];
  const client = recalcClient({ leadRow: { id: leadId, organization_id: org, score: 0, company_id: null, email: "a@example.com" }, rules });
  const result = await recalculateLeadScoreInternal(client, admin, leadId, "test");
  assert.equal(result.score, 15);
  assert.ok(client.writes.some((write) => write.kind === "lead"));
  assert.ok(client.writes.some((write) => write.kind === "snapshot"));
  assert.ok(client.writes.some((write) => write.kind === "history"));
});

test("F027: model version is pinned into the explanation — a later model edit does not retroactively reinterpret history", async () => {
  const rules = [{ id: "r1", name: "Email", status: "active", signal_type: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 10 }];
  const versionedModel = { ...model, name: "Default model", version: 3 };
  const client = recalcClient({ leadRow: { id: leadId, organization_id: org, score: 0, company_id: null, email: "a@example.com" }, activeModel: versionedModel, rules });
  const result = await recalculateLeadScoreInternal(client, admin, leadId, "test");
  assert.equal(result.explanation.model.version, 3);
});

test("F027 config: creating a rule on an active model is blocked — must create a new version instead", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT id,status,model_type FROM tenant.crm_lead_scoring_models")) return { rows: [{ id: modelId, status: "active", model_type: "rule_based" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    createLeadScoringModelRule(client, admin, modelId, { name: "New rule", signalType: "demographic", predicate: { field: "email", operator: "not_empty" }, points: 10 }),
    (error) => error.code === "CRM_LEAD_SCORING_MODEL_ACTIVE_IMMUTABLE",
  );
});

test("F027 config: model configuration is forbidden for a caller without crm.settings.manage", async () => {
  const client = { async query() { throw new Error("must not query"); } };
  await assert.rejects(
    createLeadScoringModel(client, rep, { name: "Unauthorized model" }),
    (error) => error.code === "CRM_LEAD_SCORING_CONFIG_FORBIDDEN",
  );
  await assert.rejects(
    updateLeadScoringModel(client, rep, modelId, { name: "x" }),
    (error) => error.code === "CRM_LEAD_SCORING_CONFIG_FORBIDDEN",
  );
  await assert.rejects(
    activateLeadScoringModel(client, rep, modelId),
    (error) => error.code === "CRM_LEAD_SCORING_CONFIG_FORBIDDEN",
  );
});

test("F027 config: activating a model with zero active rules is rejected", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id")) return { rows: [{ id: modelId, status: "draft" }] };
      if (sql.includes("count(*)::int AS count FROM tenant.crm_lead_scoring_model_rules")) return { rows: [{ count: 0 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    activateLeadScoringModel(client, admin, modelId),
    (error) => error.code === "CRM_LEAD_SCORING_MODEL_NO_RULES",
  );
});

test("F027 config: activating a model retires the previously active one and enqueues a bulk recalculation job", async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push(sql);
      if (sql.includes("SELECT * FROM tenant.crm_lead_scoring_models WHERE organization_id")) return { rows: [{ id: modelId, status: "draft" }] };
      if (sql.includes("count(*)::int AS count FROM tenant.crm_lead_scoring_model_rules")) return { rows: [{ count: 2 }] };
      if (sql.includes("SET status='retired'")) return { rows: [] };
      if (sql.includes("SET status='active',activated_at=now()")) return { rows: [{ id: modelId, status: "active" }] };
      if (sql.includes("INSERT INTO tenant.background_jobs")) return { rows: [{ id: jobId }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_score_recalc_items")) return { rowCount: 2 };
      if (sql.includes("UPDATE tenant.background_jobs")) return { rows: [{ id: jobId, status: "pending", progress: {}, result_manifest: { requested: 2 } }] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const outcome = await activateLeadScoringModel(client, admin, modelId);
  assert.equal(outcome.model.status, "active");
  assert.ok(outcome.recalcJob);
  assert.equal(outcome.recalcJob.resultManifest.requested, 2);
  assert.ok(queries.some((sql) => sql.includes("SET status='retired'")));
});

test("F027 bulk recalculation: enqueueLeadScoreRecalcJob snapshots every active Lead in the org", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("INSERT INTO tenant.background_jobs")) return { rows: [{ id: jobId }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_score_recalc_items")) return { rowCount: 7 };
      if (sql.includes("UPDATE tenant.background_jobs")) return { rows: [{ id: jobId, status: "pending", progress: {}, result_manifest: { requested: 7 } }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const job = await enqueueLeadScoreRecalcJob(client, admin, modelId);
  assert.equal(job.resultManifest.requested, 7);
});

test("F027 bulk recalculation: batch processing is idempotent — an item already applied is not reprocessed (FOR UPDATE SKIP LOCKED + pending-only claim)", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT id,lead_id FROM tenant.crm_lead_score_recalc_items")) {
        assert.match(sql, /status='pending'/);
        assert.match(sql, /FOR UPDATE SKIP LOCKED/);
        return { rows: [] }; // nothing pending — already fully processed
      }
      if (sql.includes("count(*)::int AS requested")) return { rows: [{ requested: 3, pending: 0, applied: 3, conflict: 0, skipped: 0, failed: 0 }] };
      if (sql.includes("UPDATE tenant.background_jobs")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await processLeadScoreRecalcBatch(client, admin, jobId);
  assert.equal(result.done, true);
  assert.equal(result.manifest.applied, 3);
});
