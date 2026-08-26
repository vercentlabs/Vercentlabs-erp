import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCrmRecord, updateCrmRecord } from "../src/modules/crm/index.js";
import { bulkUpdateLeads } from "../src/modules/crm/lead-operations.js";
import { applyOfflineMutation } from "../src/modules/crm/offline-sync.js";
import { transitionLeadStage } from "../src/modules/crm/lead-lifecycle.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.records.view_all"],
};

test("F007 migration separates lifecycle, record state and sales stages", async () => {
  const sql = await readFile(new URL("../../../database/tenant/migrations/063_crm_lead_lifecycle_f007.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tenant\.crm_lead_stages/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tenant\.crm_lead_stage_transitions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tenant\.crm_lead_stage_events/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS record_status/);
  assert.match(sql, /crm_leads_lifecycle_stage_fkey/);
  assert.match(sql, /crm_leads_stage_write_guard/);
  assert.doesNotMatch(sql, /crm_pipeline_stages.*crm_leads/i);
});

test("generic, bulk and offline paths cannot forge Lead lifecycle", async () => {
  const noQuery = { query: async () => assert.fail("governed input must fail before SQL") };
  await assert.rejects(
    createCrmRecord(noQuery, context, "leads", { status: "working" }),
    (error) => error.code === "CRM_LEAD_INITIAL_STAGE_GOVERNED",
  );
  await assert.rejects(
    updateCrmRecord(
      { query: async (sql) => sql.includes("SELECT record.*") ? { rows: [{ id: context.organizationId, status: "new", record_status: "active" }] } : assert.fail("no write is allowed") },
      context,
      "leads",
      context.organizationId,
      { status: "working" },
    ),
    (error) => error.code === "CRM_LEAD_STAGE_ACTION_REQUIRED",
  );
  await assert.rejects(
    bulkUpdateLeads(noQuery, context, { ids: [context.organizationId], changes: { stageCode: "working" } }),
    (error) => error.code === "CRM_LEAD_STAGE_ACTION_REQUIRED",
  );
  await assert.rejects(
    applyOfflineMutation({ query: async () => ({ rows: [] }) }, context, {
      clientMutationId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "f007-offline",
      operation: "create",
      resource: "leads",
      payload: { code: "LEAD-1", firstName: "A", email: "a@example.com", status: "working" },
    }),
    (error) => error.code === "CRM_OFFLINE_LEAD_STAGE_GOVERNED",
  );
});

test("canonical transition locks, validates, records history and emits one outbox event", async () => {
  const calls = [];
  const updatedAt = "2026-08-26T00:00:00.000Z";
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT lead.*,current.id AS current_stage_id"))
        return { rows: [{
          id: "44444444-4444-4444-8444-444444444444",
          organization_id: context.organizationId,
          status: "new",
          record_status: "active",
          updated_at: updatedAt,
          current_stage_id: "55555555-5555-4555-8555-555555555555",
          current_stage_name: "New",
          current_stage_status: "active",
        }] };
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.code=$2"))
        return { rows: [{
          id: "66666666-6666-4666-8666-666666666666",
          organization_id: context.organizationId,
          code: "contacted",
          name: "Contacted",
          status: "active",
          lead_count: 0,
        }] };
      if (sql.includes("FROM tenant.crm_lead_stage_transitions")) return { rows: [{ exists: 1 }] };
      if (sql.includes("UPDATE tenant.crm_leads SET status="))
        return { rows: [{ id: "44444444-4444-4444-8444-444444444444", status: "contacted", record_status: "active" }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_stage_events"))
        return { rows: [{ id: "77777777-7777-4777-8777-777777777777", from_stage_code: "new", to_stage_code: "contacted" }] };
      if (sql.includes("SELECT lead.id FROM tenant.crm_leads lead")) return { rows: [{ id: values[1] }] };
      if (sql.includes("FROM tenant.crm_lead_stage_events event")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
  };
  const result = await transitionLeadStage(client, context, "44444444-4444-4444-8444-444444444444", {
    stageCode: "contacted",
    expectedUpdatedAt: updatedAt,
    source: "kanban",
  });
  assert.equal(result.changed, true);
  assert.equal(result.record.status, "contacted");
  assert.equal(calls.filter((call) => call.sql.includes("FOR UPDATE OF lead")).length, 1);
  assert.equal(calls.filter((call) => call.sql.includes("INSERT INTO tenant.crm_lead_stage_events")).length, 1);
  assert.equal(calls.filter((call) => call.sql.includes("INSERT INTO tenant.crm_outbox_events")).length, 1);
});
