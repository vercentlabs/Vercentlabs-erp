import assert from "node:assert/strict";
import test from "node:test";

import {
  createCustomFieldDefinition,
  getCustomFieldValues,
  listCustomFieldDefinitions,
  setCustomFieldDefinitionActive,
  setCustomFieldValues,
} from "../src/modules/crm/crm-data-operations-and-customization/custom-field-runtime.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "44444444-4444-4444-8444-444444444444";
const lead = "55555555-5555-4555-8555-555555555555";
const definitionText = "66666666-6666-4666-8666-666666666666";
const definitionSelect = "77777777-7777-4777-8777-777777777777";
const definitionRequired = "88888888-8888-4888-8888-888888888888";

const context = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive", "crm.leads.manage", "crm.opportunities.manage", "crm.accounts.manage"] };

function createClient({ leadVisible = true, definitions = [], queries = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads")) return leadVisible ? { rows: [{ id: lead }] } : { rows: [] };
      if (sql.includes("SELECT * FROM custom_field_definitions WHERE organization_id=$1 AND entity_type=$2 AND status='active'"))
        return { rows: definitions };
      // Stored values (none) and the append-only history ledger.
      if (sql.startsWith("SELECT definition_id, value FROM custom_field_values")) return { rows: [] };
      if (sql.includes("INSERT INTO custom_field_value_history")) return { rows: [] };
      for (const [pattern, handler] of Object.entries(queries)) {
        if (sql.includes(pattern)) return handler(values);
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F028: createCustomFieldDefinition rejects an unsupported entity type before any query runs", async () => {
  const client = createClient();
  await assert.rejects(
    () => createCustomFieldDefinition(client, context, { entityType: "invoice", fieldKey: "x", label: "X", dataType: "text" }),
    (error) => error.code === "CRM_CUSTOM_FIELD_ENTITY_INVALID",
  );
});

test("F028: createCustomFieldDefinition rejects an invalid data type", async () => {
  const client = createClient();
  await assert.rejects(
    () => createCustomFieldDefinition(client, context, { entityType: "lead", fieldKey: "x", label: "X", dataType: "enum" }),
    (error) => error.code === "CRM_CUSTOM_FIELD_TYPE_INVALID",
  );
});

test("F028: createCustomFieldDefinition requires at least one option for a select field", async () => {
  const client = createClient();
  await assert.rejects(
    () => createCustomFieldDefinition(client, context, { entityType: "lead", fieldKey: "x", label: "X", dataType: "select", options: [] }),
    (error) => error.code === "CRM_CUSTOM_FIELD_OPTIONS_REQUIRED",
  );
});

test("F028: createCustomFieldDefinition normalizes the field key and persists configuration", async () => {
  const client = createClient({
    queries: {
      "INSERT INTO custom_field_definitions": (values) => ({
        rows: [{ id: definitionText, organization_id: org, entity_type: values[1], field_key: values[2], label: values[3], data_type: values[4], required: values[5], configuration: JSON.parse(values[6]), status: "active", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }],
      }),
    },
  });
  const record = await createCustomFieldDefinition(client, context, { entityType: "lead", fieldKey: "Preferred Channel!", label: "Preferred Channel", dataType: "text" });
  assert.equal(record.fieldKey, "preferred_channel_");
  assert.equal(record.dataType, "text");
});

test("F028: createCustomFieldDefinition maps a unique-constraint violation to a clean duplicate-key error", async () => {
  const client = createClient({
    queries: {
      "INSERT INTO custom_field_definitions": () => {
        const error = new Error("duplicate key");
        error.code = "23505";
        throw error;
      },
    },
  });
  await assert.rejects(
    () => createCustomFieldDefinition(client, context, { entityType: "lead", fieldKey: "dup", label: "Dup", dataType: "text" }),
    (error) => error.code === "CRM_CUSTOM_FIELD_DUPLICATE_KEY",
  );
});

test("F028: setCustomFieldDefinitionActive 404s for a nonexistent definition", async () => {
  const client = createClient({ queries: { "UPDATE custom_field_definitions": () => ({ rows: [] }) } });
  await assert.rejects(
    () => setCustomFieldDefinitionActive(client, context, definitionText, false),
    (error) => error.code === "CRM_CUSTOM_FIELD_NOT_FOUND",
  );
});

test("F028: getCustomFieldValues returns an empty list, not an error, when the caller cannot see the parent record", async () => {
  const client = createClient({ leadVisible: false });
  const rows = await getCustomFieldValues(client, context, "lead", lead);
  assert.deepEqual(rows, []);
});

test("F028: getCustomFieldValues merges definitions with any stored value via a LEFT JOIN, so an unset field still appears with value=null", async () => {
  const client = createClient({
    queries: {
      "FROM custom_field_definitions definition": () => ({
        rows: [{ definition_id: definitionText, field_key: "preferred_channel", label: "Preferred Channel", data_type: "text", required: false, configuration: {}, value: null, value_updated_at: null }],
      }),
    },
  });
  const rows = await getCustomFieldValues(client, context, "lead", lead);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, null);
});

test("F028: setCustomFieldValues rejects an unknown field key before writing anything", async () => {
  const client = createClient({
    definitions: [{ id: definitionText, field_key: "preferred_channel", label: "Preferred Channel", data_type: "text", required: false, configuration: {} }],
  });
  await assert.rejects(
    () => setCustomFieldValues(client, context, "lead", lead, { not_a_real_field: "x" }),
    (error) => error.code === "CRM_CUSTOM_FIELD_UNKNOWN",
  );
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO custom_field_values")));
});

test("F028: setCustomFieldValues rejects a submission missing a required field", async () => {
  const client = createClient({
    definitions: [{ id: definitionRequired, field_key: "priority_reason", label: "Priority Reason", data_type: "text", required: true, configuration: {} }],
  });
  await assert.rejects(
    () => setCustomFieldValues(client, context, "lead", lead, {}),
    (error) => error.code === "CRM_CUSTOM_FIELD_VALUE_REQUIRED",
  );
});

test("F028: setCustomFieldValues rejects an out-of-range percentage before writing anything (all-or-nothing validation)", async () => {
  const client = createClient({
    definitions: [
      { id: definitionText, field_key: "notes", label: "Notes", data_type: "text", required: false, configuration: {} },
      { id: definitionSelect, field_key: "confidence", label: "Confidence", data_type: "percentage", required: false, configuration: {} },
    ],
  });
  await assert.rejects(
    () => setCustomFieldValues(client, context, "lead", lead, { notes: "valid text", confidence: 150 }),
    (error) => error.code === "CRM_CUSTOM_FIELD_VALUE_INVALID",
  );
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO custom_field_values")), "a partially-invalid submission must write nothing, not a partial update");
});

test("F028: setCustomFieldValues rejects a select value outside its own option list", async () => {
  const client = createClient({
    definitions: [{ id: definitionSelect, field_key: "channel", label: "Channel", data_type: "select", required: false, configuration: { options: ["Email", "Phone"] } }],
  });
  await assert.rejects(
    () => setCustomFieldValues(client, context, "lead", lead, { channel: "Carrier Pigeon" }),
    (error) => error.code === "CRM_CUSTOM_FIELD_VALUE_INVALID",
  );
});

test("F028: setCustomFieldValues fails closed when the caller cannot access the parent record", async () => {
  const client = createClient({ leadVisible: false });
  await assert.rejects(
    () => setCustomFieldValues(client, context, "lead", lead, {}),
    (error) => error.code === "CRM_CUSTOM_FIELD_RELATION_INVALID",
  );
});

test("F028: setCustomFieldValues upserts a valid value and queues an outbox event", async () => {
  const client = createClient({
    definitions: [{ id: definitionText, field_key: "preferred_channel", label: "Preferred Channel", data_type: "select", required: false, configuration: { options: ["Email", "Phone"] } }],
    queries: {
      "INSERT INTO custom_field_values": () => ({ rows: [], rowCount: 1 }),
      "INSERT INTO tenant.platform_events": () => ({ rows: [], rowCount: 1 }),
      "FROM custom_field_definitions definition": () => ({
        rows: [{ definition_id: definitionText, field_key: "preferred_channel", label: "Preferred Channel", data_type: "select", required: false, configuration: { options: ["Email", "Phone"] }, value: "Email", value_updated_at: "2026-09-01T00:00:00.000Z" }],
      }),
    },
  });
  const rows = await setCustomFieldValues(client, context, "lead", lead, { preferred_channel: "Email" });
  assert.equal(rows[0].value, "Email");
  const insert = client.calls.find(({ sql }) => sql.includes("INSERT INTO custom_field_values"));
  assert.ok(insert.sql.includes("ON CONFLICT"), "must upsert, not fail on a second save of the same field");
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.platform_events")));
});
