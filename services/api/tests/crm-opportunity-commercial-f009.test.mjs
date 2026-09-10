import assert from "node:assert/strict";
import test from "node:test";

import {
  addOpportunityItem,
  updateOpportunityItem,
  removeOpportunityItem,
  addOpportunityTeamMember,
  removeOpportunityTeamMember,
  addOpportunityCompetitor,
  removeOpportunityCompetitor,
} from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-commercial.js";
import { saveOpportunityRevenueSplits } from "../src/modules/crm/opportunity-revenue-intelligence.js";
import {
  enqueueOpportunityStageMigrationJob,
  processOpportunityStageMigrationBatch,
} from "../src/modules/crm/opportunity-and-pipeline-governance/stage-migration.js";
import { computeStageAge } from "../src/modules/crm/opportunity-and-pipeline-governance/stage-aging.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const opportunityId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const itemRowId = "55555555-5555-4555-8555-555555555555";
const userA = "66666666-6666-4666-8666-666666666666";
const userB = "77777777-7777-4777-8777-777777777777";
const teamMemberA = "88888888-8888-4888-8888-888888888888";
const teamMemberB = "99999999-9999-4999-8999-999999999999";
const competitorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fromStageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const toStageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const jobId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const context = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.records.view_all", "crm.opportunities.manage"],
};

function openOpportunityRow(overrides = {}) {
  return {
    id: opportunityId,
    organization_id: org,
    status: "open",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Opportunity items
// ---------------------------------------------------------------------------

test("F009: adding an item requires the parent Opportunity to be in scope (record not found -> 404)", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    addOpportunityItem(client, context, opportunityId, { itemId, quantity: 2 }),
    (error) => error.code === "CRM_OPPORTUNITY_NOT_FOUND",
  );
});

test("F009: adding an item is blocked once the Opportunity is closed", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record"))
        return { rows: [openOpportunityRow({ status: "won" })] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    addOpportunityItem(client, context, opportunityId, { itemId, quantity: 2 }),
    (error) => error.code === "CRM_OPPORTUNITY_ITEM_LOCKED",
  );
});

test("F009: adding an item defaults unit price from the catalogue and writes a real INSERT", async () => {
  const inserts = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      if (sql.includes("FROM tenant.items WHERE")) return { rows: [{ id: itemId, sales_price: "199.50" }] };
      if (sql.includes("INSERT INTO tenant.crm_opportunity_items")) {
        inserts.push(values);
        return { rows: [{ id: itemRowId, unit_price: 199.5, item_id: itemId, quantity: 2 }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await addOpportunityItem(client, context, opportunityId, { itemId, quantity: 2 });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][6], 199.5); // unit_price positional param
  assert.equal(result.quantity, 2);
});

test("F009: an invalid quantity is rejected before any write to the item catalogue join", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      throw new Error(`Should not query further: ${sql}`);
    },
  };
  await assert.rejects(
    addOpportunityItem(client, context, opportunityId, { itemId: "", quantity: 0 }),
    (error) => error.code === "CRM_OPPORTUNITY_ITEM_INVALID",
  );
});

test("F009: removing an item that does not belong to this Opportunity 404s (no cross-opportunity delete)", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      if (sql.startsWith("DELETE FROM tenant.crm_opportunity_items")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    removeOpportunityItem(client, context, opportunityId, itemRowId),
    (error) => error.code === "CRM_OPPORTUNITY_ITEM_NOT_FOUND",
  );
});

test("F009: updating an item only sets the fields actually supplied", async () => {
  let updateSql = null;
  let updateValues = null;
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      if (sql.startsWith("UPDATE tenant.crm_opportunity_items")) {
        updateSql = sql;
        updateValues = values;
        return { rows: [{ id: itemRowId, quantity: 5 }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await updateOpportunityItem(client, context, opportunityId, itemRowId, { quantity: 5 });
  assert.match(updateSql, /quantity=\$4/);
  assert.doesNotMatch(updateSql, /unit_price=/);
  assert.equal(updateValues[3], 5);
});

// ---------------------------------------------------------------------------
// Opportunity team (standalone)
// ---------------------------------------------------------------------------

test("F009: a team member can be added without a revenue split (standalone team management)", async () => {
  const inserts = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      if (sql.includes("FROM public.organization_memberships")) return { rows: [{}] };
      if (sql.includes("INSERT INTO tenant.crm_opportunity_team_members")) {
        inserts.push(values);
        return { rows: [{ id: teamMemberA, user_id: userA, team_role: "observer", access_level: "view" }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await addOpportunityTeamMember(client, context, opportunityId, {
    userId: userA, teamRole: "observer", accessLevel: "view",
  });
  assert.equal(result.accessLevel, "view");
  assert.equal(inserts.length, 1);
});

test("F009: removing a team member also removes their now-meaningless revenue splits", async () => {
  const deletes = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      if (sql.startsWith("DELETE FROM tenant.crm_opportunity_team_members")) {
        deletes.push(["team_members", values]);
        return { rows: [{ user_id: userA }] };
      }
      if (sql.startsWith("DELETE FROM tenant.crm_opportunity_revenue_splits")) {
        deletes.push(["revenue_splits", values]);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await removeOpportunityTeamMember(client, context, opportunityId, teamMemberA);
  assert.deepEqual(deletes.map(([kind]) => kind), ["team_members", "revenue_splits"]);
});

// CRM-VNEXT: real bug found and fixed this prompt — saveOpportunityRevenueSplits
// used to DELETE every team member for the opportunity before recreating only
// the ones present in the new splits payload, silently destroying any team
// member (e.g. a view-only observer, or one on a different split type) who
// wasn't part of this particular call.
test("F009 bugfix: saving revenue splits for one split type does not delete team members outside that call", async () => {
  const deletedTeamMemberQueries = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.id=$2"))
        return { rows: [openOpportunityRow()] };
      if (sql.startsWith("DELETE FROM tenant.crm_opportunity_team_members")) {
        // The old buggy code deleted ALL team members unconditionally here.
        deletedTeamMemberQueries.push(sql);
        return { rows: [] };
      }
      if (sql.startsWith("DELETE FROM tenant.crm_opportunity_revenue_splits")) {
        assert.deepEqual(values[2], ["revenue"]); // only the 'revenue' split type is cleared
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO tenant.crm_opportunity_team_members")) {
        return { rows: [{ id: teamMemberB }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_opportunity_revenue_splits")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await saveOpportunityRevenueSplits(client, context, {
    opportunityId,
    splits: [{ userId: userB, role: "closer", splitType: "revenue", percent: 100 }],
  });
  // The fixed code never issues an unconditional "delete every team member" query.
  assert.equal(deletedTeamMemberQueries.length, 0);
});

// ---------------------------------------------------------------------------
// Opportunity competitors
// ---------------------------------------------------------------------------

test("F009: linking a competitor as primary clears any other primary flag first", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      if (sql.includes("FROM tenant.crm_competitors WHERE")) return { rows: [{ id: competitorId }] };
      if (sql.startsWith("UPDATE tenant.crm_opportunity_competitors SET is_primary=false")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_opportunity_competitors")) return { rows: [{ competitor_id: competitorId, is_primary: true }] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await addOpportunityCompetitor(client, context, opportunityId, { competitorId, isPrimary: true });
  assert.ok(calls.some((sql) => sql.startsWith("UPDATE tenant.crm_opportunity_competitors SET is_primary=false")));
});

test("F009: unlinking a competitor that was never linked 404s", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record")) return { rows: [openOpportunityRow()] };
      if (sql.startsWith("DELETE FROM tenant.crm_opportunity_competitors")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    removeOpportunityCompetitor(client, context, opportunityId, competitorId),
    (error) => error.code === "CRM_OPPORTUNITY_COMPETITOR_NOT_LINKED",
  );
});

// ---------------------------------------------------------------------------
// F012 stage migration
// ---------------------------------------------------------------------------

test("F012: enqueueing a migration snapshots every open Opportunity currently on the source stage", async () => {
  let insertedManifest = null;
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND id=$2") && values[1] === toStageId)
        return { rows: [{ id: toStageId, pipeline_id: "pipe-1", status: "active" }] };
      if (sql.includes("FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND id=$2") && values[1] === fromStageId)
        return { rows: [{ id: fromStageId, pipeline_id: "pipe-1" }] };
      if (sql.startsWith("INSERT INTO tenant.background_jobs"))
        return { rows: [{ id: jobId, job_type: "crm.opportunities.stage_migration", status: "pending", attempts: 0, max_attempts: 5 }] };
      if (sql.startsWith("INSERT INTO tenant.crm_opportunity_stage_migration_items"))
        return { rowCount: 3, rows: [{ id: "i1" }, { id: "i2" }, { id: "i3" }] };
      if (sql.startsWith("UPDATE tenant.background_jobs")) {
        insertedManifest = JSON.parse(values[2]);
        return { rows: [{ id: jobId, job_type: "crm.opportunities.stage_migration", status: "pending", progress: values[2], result_manifest: values[2] }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const job = await enqueueOpportunityStageMigrationJob(client, context, fromStageId, toStageId);
  assert.equal(job.id, jobId);
  assert.equal(insertedManifest.requested, 3);
});

test("F012: migrating into the same stage is rejected", async () => {
  const client = { async query() { throw new Error("should not query"); } };
  await assert.rejects(
    enqueueOpportunityStageMigrationJob(client, context, fromStageId, fromStageId),
    (error) => error.code === "CRM_SALES_STAGE_MIGRATION_SAME_STAGE",
  );
});

test("F012: an already-migrated (conflict) item is marked conflict, not applied, and does not abort the batch", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunity_stage_migration_items") && sql.includes("FOR UPDATE SKIP LOCKED"))
        return { rows: [{ id: "item-1", opportunity_id: opportunityId, to_stage_id: toStageId, expected_updated_at: "2026-01-01T00:00:00.000Z" }] };
      if (sql === "SAVEPOINT crm_opportunity_stage_migration_item") return { rows: [] };
      if (sql.includes("FROM tenant.crm_opportunities record WHERE record.organization_id = $1 AND record.id = $2"))
        return { rows: [{ id: opportunityId, stage_id: fromStageId, status: "open", updated_at: "2026-02-02T00:00:00.000Z" }] }; // updated_at no longer matches -> stale write
      if (sql === "ROLLBACK TO SAVEPOINT crm_opportunity_stage_migration_item") return { rows: [] };
      if (sql === "RELEASE SAVEPOINT crm_opportunity_stage_migration_item") return { rows: [] };
      if (sql.startsWith("UPDATE tenant.crm_opportunity_stage_migration_items SET status=")) {
        assert.equal(values[2], "conflict");
        return { rows: [] };
      }
      if (sql.includes("count(*) FILTER (WHERE status='pending')"))
        return { rows: [{ requested: 1, pending: 0, applied: 0, conflict: 1, skipped: 0, failed: 0 }] };
      if (sql.startsWith("UPDATE tenant.background_jobs")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await processOpportunityStageMigrationBatch(client, context, jobId);
  assert.equal(result.done, true);
  assert.equal(result.manifest.conflict, 1);
  assert.equal(result.manifest.applied, 0);
});

// ---------------------------------------------------------------------------
// F010 stage aging (pure function)
// ---------------------------------------------------------------------------

test("F010: stage age is computed from stage_entered_at, never from updated_at", () => {
  const now = new Date("2026-03-10T00:00:00.000Z");
  const age = computeStageAge(
    { stage_entered_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-09T00:00:00.000Z", sla_maximum_days: 14 },
    now,
  );
  assert.equal(age.ageDays, 9);
  assert.equal(age.status, "ok");
});

test("F010: an SLA policy's maximum_days takes precedence over the stage's own stale_after_days", () => {
  const now = new Date("2026-03-20T00:00:00.000Z");
  const age = computeStageAge(
    { stage_entered_at: "2026-03-01T00:00:00.000Z", sla_maximum_days: 10, stale_after_days: 30 },
    now,
  );
  assert.equal(age.ageDays, 19);
  assert.equal(age.maximumDays, 10);
  assert.equal(age.status, "breached");
});

test("F010: no stage_entered_at yields an unknown status rather than a false ok/breach signal", () => {
  const age = computeStageAge({ stage_entered_at: null, sla_maximum_days: 14 });
  assert.equal(age.ageDays, null);
  assert.equal(age.status, "unknown");
});
