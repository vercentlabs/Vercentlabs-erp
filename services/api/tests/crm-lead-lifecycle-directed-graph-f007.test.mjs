import assert from "node:assert/strict";
import test from "node:test";

import {
  addLeadStageTransition,
  removeLeadStageTransition,
  findApplicableTransitionReasons,
} from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/transition-graph.js";
import { transitionLeadStage } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/transition-engine.js";
import { deactivateLeadStageWithMigration, enqueueLeadStageMigrationJob, processLeadStageMigrationBatch } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/stage-migration.js";
import { getLeadStageDwell } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/stage-catalog.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const leadId = "33333333-3333-4333-8333-333333333333";
const stageNewId = "44444444-4444-4444-8444-444444444444";
const stageWorkingId = "55555555-5555-4555-8555-555555555555";

const context = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.records.view_all"],
};

test("F007: adding a transition is directional — A->B does not create B->A", async () => {
  const inserts = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.id=$2"))
        return { rows: [{ id: values[1], organization_id: org, code: values[1] === stageNewId ? "new" : "working", name: values[1] === stageNewId ? "New" : "Working", status: "active", lead_count: 0 }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_stage_transitions")) {
        inserts.push(values);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await addLeadStageTransition(client, context, stageNewId, stageWorkingId, { reasonRequired: false });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], stageNewId);
  assert.equal(inserts[0][2], stageWorkingId);
  // The reverse direction was never inserted — confirms no auto-symmetric edge.
  assert.equal(inserts.some((row) => row[1] === stageWorkingId && row[2] === stageNewId), false);
});

test("F007: a transition not present in the graph is rejected (forbidden B->A)", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("SELECT lead.*,current.id AS current_stage_id"))
        return {
          rows: [{
            id: leadId, organization_id: org, status: "working", record_status: "active", updated_at: "2026-01-01T00:00:00.000Z",
            current_stage_id: stageWorkingId, current_stage_name: "Working", current_stage_status: "active",
          }],
        };
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.code=$2"))
        return { rows: [{ id: stageNewId, organization_id: org, code: "new", name: "New", status: "active", lead_count: 0 }] };
      if (sql.includes("SELECT reason_required FROM tenant.crm_lead_stage_transitions"))
        return { rows: [] }; // no edge working -> new
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    transitionLeadStage(client, context, leadId, { stageCode: "new" }),
    (error) => error.code === "CRM_LEAD_STAGE_TRANSITION_INVALID",
  );
});

test("F007: a transition marked reason_required rejects a move with no reasonCode", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT lead.*,current.id AS current_stage_id"))
        return {
          rows: [{
            id: leadId, organization_id: org, status: "new", record_status: "active", updated_at: "2026-01-01T00:00:00.000Z",
            current_stage_id: stageNewId, current_stage_name: "New", current_stage_status: "active",
          }],
        };
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.code=$2"))
        return { rows: [{ id: stageWorkingId, organization_id: org, code: "working", name: "Working", status: "active", lead_count: 0 }] };
      if (sql.includes("SELECT reason_required FROM tenant.crm_lead_stage_transitions"))
        return { rows: [{ reason_required: true }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    transitionLeadStage(client, context, leadId, { stageCode: "working" }),
    (error) => error.code === "CRM_LEAD_STAGE_REASON_REQUIRED",
  );
});

test("F007: a reasonCode that doesn't match any applicable governed reason is rejected", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT lead.*,current.id AS current_stage_id"))
        return {
          rows: [{
            id: leadId, organization_id: org, status: "new", record_status: "active", updated_at: "2026-01-01T00:00:00.000Z",
            current_stage_id: stageNewId, current_stage_name: "New", current_stage_status: "active",
          }],
        };
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.code=$2"))
        return { rows: [{ id: stageWorkingId, organization_id: org, code: "working", name: "Working", status: "active", lead_count: 0 }] };
      if (sql.includes("SELECT reason_required FROM tenant.crm_lead_stage_transitions"))
        return { rows: [{ reason_required: false }] };
      if (sql.includes("FROM tenant.crm_lead_stage_transition_reasons"))
        return { rows: [{ code: "real_reason", label: "Real reason" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    transitionLeadStage(client, context, leadId, { stageCode: "working", reasonCode: "made_up" }),
    (error) => error.code === "CRM_LEAD_STAGE_REASON_INVALID",
  );
});

test("F007: a successful transition sets stage_entered_at (dwell start) and resets dwell_breach_notified_at in the same statement as status", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT lead.*,current.id AS current_stage_id"))
        return {
          rows: [{
            id: leadId, organization_id: org, status: "new", record_status: "active", updated_at: "2026-01-01T00:00:00.000Z",
            current_stage_id: stageNewId, current_stage_name: "New", current_stage_status: "active",
          }],
        };
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.code=$2"))
        return { rows: [{ id: stageWorkingId, organization_id: org, code: "working", name: "Working", status: "active", lead_count: 0 }] };
      if (sql.includes("SELECT reason_required FROM tenant.crm_lead_stage_transitions"))
        return { rows: [{ reason_required: false }] };
      if (sql.includes("UPDATE tenant.crm_leads SET status="))
        return { rows: [{ id: leadId, status: "working", record_status: "active" }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_stage_events")) return { rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }] };
      if (sql.includes("SELECT lead.id FROM tenant.crm_leads lead")) return { rows: [{ id: leadId }] };
      if (sql.includes("FROM tenant.crm_lead_stage_events event")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
  };
  await transitionLeadStage(client, context, leadId, { stageCode: "working" });
  const update = calls.find((call) => call.sql.includes("UPDATE tenant.crm_leads SET status="));
  assert.match(update.sql, /stage_entered_at=now\(\)/);
  assert.match(update.sql, /dwell_breach_notified_at=NULL/);
});

test("F007: findApplicableTransitionReasons precedence — transition-scoped wins over destination, which wins over any", async () => {
  const client = {
    async query(sql) {
      assert.match(sql, /ORDER BY \(scope_type='transition'\) DESC,\(scope_type='destination'\) DESC/);
      return {
        rows: [
          { scope_type: "transition", code: "specific" },
          { scope_type: "destination", code: "into_working" },
          { scope_type: "any", code: "generic" },
        ],
      };
    },
  };
  const reasons = await findApplicableTransitionReasons(client, context, stageNewId, stageWorkingId);
  assert.equal(reasons[0].code, "specific");
});

test("F007 safe deactivation: blocked with the affected count when active Leads remain and no migration target is given", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.id=$2"))
        return { rows: [{ id: stageNewId, organization_id: org, code: "new", name: "New", status: "active", is_initial: false, lead_count: 3 }] };
      if (sql.includes("SELECT count(*)::int AS count FROM tenant.crm_lead_stages"))
        return { rows: [{ count: 1 }] };
      if (sql.includes("SELECT count(*)::int AS count FROM tenant.crm_leads"))
        return { rows: [{ count: 3 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    deactivateLeadStageWithMigration(client, context, stageNewId, {}),
    (error) => error.code === "CRM_LEAD_STAGE_HAS_ACTIVE_LEADS" && error.message.startsWith("3 active Lead"),
  );
});

test("F007 safe deactivation: succeeds immediately with zero active Leads", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.id=$2"))
        return { rows: [{ id: stageNewId, organization_id: org, code: "new", name: "New", status: values.includes("inactive") ? "inactive" : "active", is_initial: false, lead_count: 0 }] };
      if (sql.includes("SELECT count(*)::int AS count FROM tenant.crm_lead_stages"))
        return { rows: [{ count: 1 }] };
      if (sql.includes("SELECT count(*)::int AS count FROM tenant.crm_leads"))
        return { rows: [{ count: 0 }] };
      if (sql.startsWith("UPDATE tenant.crm_lead_stages SET status='inactive'")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await deactivateLeadStageWithMigration(client, context, stageNewId, {});
  assert.equal(result.deactivated, true);
});

test("F007 migration job: enqueues one item per active Lead currently on the source stage", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.id=$2"))
        return { rows: [{ id: values[1], organization_id: org, code: values[1] === stageNewId ? "new" : "working", name: values[1] === stageNewId ? "New" : "Working", status: "active", lead_count: 0 }] };
      if (sql.includes("INSERT INTO tenant.background_jobs")) return { rows: [{ id: "jjjjjjjj-jjjj-4jjj-8jjj-jjjjjjjjjjjj" }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_stage_migration_items")) return { rowCount: 5 };
      if (sql.includes("UPDATE tenant.background_jobs")) return { rows: [{ id: "jjjjjjjj-jjjj-4jjj-8jjj-jjjjjjjjjjjj", status: "pending", progress: { requested: 5 }, result_manifest: { requested: 5 } }] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const job = await enqueueLeadStageMigrationJob(client, context, stageNewId, stageWorkingId);
  assert.equal(job.resultManifest.requested, 5);
});

test("F007 migration job: rejects migrating a stage into itself", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.id=$2"))
        return { rows: [{ id: values[1], organization_id: org, code: "new", name: "New", status: "active", lead_count: 0 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    enqueueLeadStageMigrationJob(client, context, stageNewId, stageNewId),
    (error) => error.code === "CRM_LEAD_STAGE_MIGRATION_SAME_STAGE",
  );
});

test("F007 migration batch: an already-migrated (conflict) item is marked conflict, not applied, and does not abort the batch", async () => {
  const jobId = "jjjjjjjj-jjjj-4jjj-8jjj-jjjjjjjjjjjj";
  const itemId = "iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii";
  const updates = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("SELECT id,lead_id,from_stage_id,to_stage_id,expected_updated_at"))
        return { rows: [{ id: itemId, lead_id: leadId, from_stage_id: stageNewId, to_stage_id: stageWorkingId, expected_updated_at: "2026-01-01T00:00:00.000Z" }] };
      if (sql === "SAVEPOINT crm_lead_stage_migration_item") return {};
      if (sql === "ROLLBACK TO SAVEPOINT crm_lead_stage_migration_item") return {};
      if (sql === "RELEASE SAVEPOINT crm_lead_stage_migration_item") return {};
      if (sql.includes("SELECT lead.*,current.id AS current_stage_id"))
        return {
          rows: [{
            id: leadId, organization_id: org, status: "new", record_status: "active",
            updated_at: "2026-01-02T00:00:00.000Z", // changed since snapshot — stale
            current_stage_id: stageNewId, current_stage_name: "New", current_stage_status: "active",
          }],
        };
      if (sql.includes("UPDATE tenant.crm_lead_stage_migration_items")) {
        updates.push(values);
        return { rows: [] };
      }
      if (sql.includes("count(*)::int AS requested")) return { rows: [{ requested: 1, pending: 0, applied: 0, conflict: 1, skipped: 0, failed: 0 }] };
      if (sql.includes("UPDATE tenant.background_jobs")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await processLeadStageMigrationBatch(client, context, jobId);
  assert.equal(result.done, true);
  assert.equal(updates[0][2], "conflict");
});

test("F007 dwell: getLeadStageDwell computes elapsed/warning/breach from stage_entered_at, not updated_at", async () => {
  const enteredAt = new Date(Date.now() - 5 * 3_600_000).toISOString(); // 5 hours ago
  const client = {
    async query(sql) {
      if (sql.includes("SELECT lead.stage_entered_at"))
        return { rows: [{ stage_entered_at: enteredAt, dwell_warning_hours: 2, dwell_breach_hours: 4 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const dwell = await getLeadStageDwell(client, context, leadId);
  assert.equal(dwell.status, "breached");
  assert.ok(dwell.elapsedHours >= 4.9);
});

test("F007: removeLeadStageTransition 404s on a non-existent edge", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("DELETE FROM tenant.crm_lead_stage_transitions")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    removeLeadStageTransition(client, context, stageNewId, stageWorkingId),
    (error) => error.code === "CRM_LEAD_STAGE_TRANSITION_NOT_FOUND",
  );
});
