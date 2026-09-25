import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpportunityTimeline,
  bulkUpdateOpportunities,
  captureForecastSnapshot,
} from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-operations.js";
import { saveOpportunityRevenueSplits } from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-revenue-intelligence.js";
import { applyOfflineMutation } from "../src/modules/crm/crm-data-operations-and-customization/offline-sync.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const opportunityId = "33333333-3333-4333-8333-333333333333";
const myCompany = "44444444-4444-4444-8444-444444444444";
const otherCompany = "55555555-5555-4555-8555-555555555555";
const stageId = "66666666-6666-4666-8666-666666666666";

// A restricted actor: real company scope, NOT allowAllCompanies, NOT
// crm.records.view_all — the exact profile that previously bypassed scope
// on every function in this file (CRM-VNEXT bug found and fixed this prompt).
const restrictedContext = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

test("F009 security fix: getOpportunityTimeline 404s for an opportunity outside the caller's company scope", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE")) {
        // Simulate the real record-scope predicate excluding a foreign-company row.
        assert.ok(sql.includes("record.company_id"));
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    getOpportunityTimeline(client, restrictedContext, opportunityId),
    (error) => error.code === "CRM_OPPORTUNITY_NOT_FOUND" && error.status === 404,
  );
});

test("F009/F029 security fix: bulkUpdateOpportunities never updates an out-of-scope Opportunity and reports it as skipped", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      // Every scoped read finds nothing (the scope predicate excludes the row).
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await bulkUpdateOpportunities(client, restrictedContext, {
    ids: [opportunityId],
    changes: { nextStep: "Follow up" },
  });
  assert.equal(result.updated, 0);
  assert.equal(result.items[0].status, "skipped");
  assert.ok(!statements.some((sql) => /^s*UPDATE tenant.crm_opportunities/.test(sql)), "no write reaches the out-of-scope row");
});

test("F009 security fix: captureForecastSnapshot 404s rather than snapshotting an out-of-scope Opportunity", async () => {
  const client = {
    async query(sql) {
      if (sql.startsWith("INSERT INTO tenant.crm_opportunity_forecast_snapshots")) {
        assert.match(sql, /record\.company_id/);
        return { rows: [] }; // scope predicate excluded the row
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    captureForecastSnapshot(client, restrictedContext, opportunityId),
    (error) => error.code === "CRM_OPPORTUNITY_NOT_FOUND" && error.status === 404,
  );
});

test("F009 security fix: saveOpportunityRevenueSplits' requireOpportunity now enforces record scope, not just organization_id", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.id=$2")) {
        assert.match(sql, /company_id/, "requireOpportunity must apply recordScope, not a bare organization_id check");
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    saveOpportunityRevenueSplits(client, restrictedContext, {
      opportunityId,
      splits: [{ userId: actorId, splitType: "revenue", percent: 100 }],
    }),
    (error) => error.code === "CRM_OPPORTUNITY_NOT_FOUND",
  );
});

test("F009/F012 bugfix: an offline-synced stage move is routed through the governed moveOpportunityStage command, not a raw UPDATE", async () => {
  // Previously this raw-UPDATE path only ever wrote stage_id — never status/
  // probability/forecast_category — and had zero permission/scope/legality
  // checks. Confirm it now goes through the same locked, validated,
  // history-writing command every other stage move uses.
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.includes("FROM tenant.crm_mobile_mutations")) return { rows: [] };
      if (sql === "SELECT id,stage_id,updated_at,status FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2")
        return { rows: [{ id: opportunityId, stage_id: "old-stage", updated_at: "2026-01-01T00:00:00.000Z", status: "open" }] };
      if (sql.startsWith("SELECT set_config('app.crm_opportunity_lifecycle_transition'")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
        return {
          rows: [{
            id: opportunityId, organization_id: org, company_id: myCompany, stage_id: "old-stage",
            status: "open", updated_at: "2026-01-01T00:00:00.000Z",
          }],
        };
      if (sql.includes("FROM tenant.crm_pipeline_stages WHERE"))
        return { rows: [{ id: stageId, pipeline_id: "pipe-1", probability: 30, forecast_category: "pipeline", is_won: false, is_lost: false }] };
      if (sql.includes("FROM tenant.crm_playbook_questions"))
        return { rows: [] };
      if (sql.startsWith("UPDATE tenant.crm_opportunities"))
        return { rows: [{ id: opportunityId, stage_id: stageId, status: "open", updated_at: "2026-01-02T00:00:00.000Z" }] };
      if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      if (sql.startsWith("INSERT INTO tenant.crm_mobile_mutations")) return { rows: [{ id: "mutation-1" }] };
      if (sql.startsWith("INSERT INTO tenant.crm_mobile_change_log")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const context = { ...restrictedContext, allowAllCompanies: true, permissions: ["crm.view", "crm.opportunities.manage", "crm.records.view_all"] };
  await applyOfflineMutation(client, context, {
    clientMutationId: "client-1",
    deviceId: "device-1",
    operation: "stage",
    resource: "opportunities",
    recordId: opportunityId,
    idempotencyKey: "idem-1",
    payload: { stageId },
  });
  assert.equal(calls.some((sql) => sql.startsWith("UPDATE tenant.crm_opportunities SET stage_id=$3,next_step=")), false, "the old raw UPDATE must no longer exist");
  assert.equal(calls.some((sql) => sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")), true, "a real governed transition must write stage history");
});
