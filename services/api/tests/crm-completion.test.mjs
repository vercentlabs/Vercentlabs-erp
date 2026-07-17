import assert from "node:assert/strict";
import test from "node:test";

import {
  createCrmRecord,
  getCrmReport,
  isCrmResource,
  listCrmRecords,
  runCrmAutomation,
} from "../src/crm.js";

const context = {
  organizationId: "00000000-0000-4000-8000-000000000000",
  userId: "00000000-0000-4000-8000-000000000001",
  activeCompanyId: "00000000-0000-4000-8000-000000000002",
  activeBranchId: null,
  allowAllCompanies: false,
};

const completionResources = [
  "engagement-templates",
  "meeting-links",
  "sync-accounts",
  "conversations",
  "conversation-insights",
  "pipeline-inspections",
  "deal-risks",
  "recommendations",
  "buying-committees",
  "buying-committee-members",
  "relationship-edges",
  "account-signals",
  "partner-accounts",
  "partner-deals",
  "report-definitions",
  "dashboards",
  "dashboard-widgets",
  "custom-object-definitions",
  "custom-field-definitions",
  "custom-records",
  "field-visits",
  "enrichment-jobs",
  "ai-predictions",
  "ai-feedback",
];

test("service recognizes every CRM completion resource", () => {
  for (const resource of completionResources)
    assert.equal(isCrmResource(resource), true, resource);
});

test("new resources retain organization and company scope", async () => {
  let capturedSql = "";
  const client = {
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    },
  };

  await listCrmRecords(client, context, "partner-deals", {});
  assert.match(capturedSql, /record\.organization_id = \$1/);
  assert.match(capturedSql, /record\.company_id IS NULL/);
});

test("custom records enforce active definitions and required dynamic fields", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("crm_custom_object_definitions"))
        return { rows: [{ id: "object", company_scoped: true }] };
      if (sql.includes("crm_custom_field_definitions"))
        return {
          rows: [
            {
              field_key: "industry_code",
              data_type: "text",
              required: true,
              unique_value: false,
              options: [],
              validation: {},
            },
          ],
        };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await assert.rejects(
    () =>
      createCrmRecord(client, context, "custom-records", {
        objectDefinitionId: "00000000-0000-4000-8000-000000000010",
        recordName: "Factory",
        data: {},
      }),
    /industry_code is required/,
  );
});

test("custom records reject fields not defined by the active object", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("crm_custom_object_definitions"))
        return { rows: [{ id: "object", company_scoped: true }] };
      if (sql.includes("crm_custom_field_definitions")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await assert.rejects(
    () =>
      createCrmRecord(client, context, "custom-records", {
        objectDefinitionId: "00000000-0000-4000-8000-000000000010",
        recordName: "Factory",
        data: { undeclared: true },
      }),
    /Unknown custom fields: undeclared/,
  );
});

test("pipeline intelligence report is tenant and company scoped", async () => {
  let capturedSql = "";
  const client = {
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    },
  };

  const result = await getCrmReport(client, context, "pipeline-intelligence");
  assert.equal(result.report, "pipeline-intelligence");
  assert.match(capturedSql, /tenant\.crm_pipeline_inspections/);
  assert.match(capturedSql, /inspection\.organization_id = \$1/);
  assert.match(capturedSql, /inspection\.company_id/);
});

test("automation can emit governed outbox events without external credentials", async () => {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM tenant.crm_automation_rules"))
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000020",
              conditions: [],
              actions: [
                {
                  type: "emit_event",
                  eventType: "crm.test.completed",
                  payload: { ok: true },
                },
              ],
            },
          ],
        };
      return { rows: [] };
    },
  };

  const result = await runCrmAutomation(
    client,
    context,
    "lead.created",
    "lead",
    "00000000-0000-4000-8000-000000000030",
    { name: "Example" },
  );

  assert.equal(result[0].status, "succeeded");
  assert.ok(
    calls.some(
      ({ sql, parameters }) =>
        sql.includes("INSERT INTO tenant.crm_outbox_events") &&
        parameters.includes("crm.test.completed"),
    ),
  );
});
