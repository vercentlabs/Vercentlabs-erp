import assert from "node:assert/strict";
import test from "node:test";

import {
  createCrmRecord,
  getCrmRecord,
  listCrmRecords,
  updateCrmRecord,
} from "../src/modules/crm/index.js";

const orgId = "11111111-1111-4111-8111-111111111111";
const objectDefinitionId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";

const repContext = {
  organizationId: orgId,
  userId: "44444444-4444-4444-8444-444444444444",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.customization.manage"],
};
const managerContext = { ...repContext, roleSlugs: ["sales_manager"] };
const ownerContext = { ...repContext, roleSlugs: ["organization_owner"] };

const fieldDefinitionRows = [
  { field_key: "notes", data_type: "text", required: false, unique_value: false, options: [], validation: {}, visible_to_roles: null },
  { field_key: "credit_score", data_type: "number", required: false, unique_value: false, options: [], validation: {}, visible_to_roles: ["sales_manager", "organization_owner"] },
];

function customRecordClient({ existingData = { notes: "hi", credit_score: 720 } } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_custom_object_definitions"))
        return { rows: [{ id: objectDefinitionId, company_scoped: false }] };
      if (sql.includes("FROM tenant.crm_custom_field_definitions") && sql.includes("field_key, data_type"))
        return { rows: fieldDefinitionRows };
      if (sql.includes("FROM tenant.crm_custom_field_definitions") && sql.includes("visible_to_roles IS NOT NULL"))
        return {
          rows: fieldDefinitionRows
            .filter((field) => field.visible_to_roles)
            .map((field) => ({ object_definition_id: objectDefinitionId, field_key: field.field_key, visible_to_roles: field.visible_to_roles })),
        };
      if (sql.includes("INSERT INTO tenant.crm_custom_records"))
        return { rows: [{ id: recordId, object_definition_id: objectDefinitionId, data: values.find((v) => v && typeof v === "object" && !Array.isArray(v)) || existingData }] };
      if (sql.includes("SELECT record.*") && sql.includes("FROM tenant.crm_custom_records"))
        return { rows: [{ id: recordId, object_definition_id: objectDefinitionId, record_name: "Acme deal risk", data: existingData }] };
      if (sql.includes("UPDATE tenant.crm_custom_records"))
        return { rows: [{ id: recordId, object_definition_id: objectDefinitionId, data: values.find((v) => v && typeof v === "object" && !Array.isArray(v)) || existingData }] };
      if (sql.includes("count(*)::int AS count") || sql.includes("count(*)::int AS total"))
        return { rows: [{ count: 1, total: 1 }] };
      return { rows: [] };
    },
  };
}

test("F028: a restricted viewer never sees a role-restricted custom field value", async () => {
  const client = customRecordClient();
  const record = await getCrmRecord(client, repContext, "custom-records", recordId);
  assert.equal(record.data.notes, "hi");
  assert.equal(Object.prototype.hasOwnProperty.call(record.data, "credit_score"), false);
  assert.equal(record.restrictedFieldsHidden, true);
});

test("F028: an authorized viewer (manager) still sees the restricted field", async () => {
  const client = customRecordClient();
  const record = await getCrmRecord(client, managerContext, "custom-records", recordId);
  assert.equal(record.data.credit_score, 720);
  assert.equal(record.restrictedFieldsHidden, undefined);
});

test("F028: organization_owner always sees restricted fields", async () => {
  const client = customRecordClient();
  const record = await getCrmRecord(client, ownerContext, "custom-records", recordId);
  assert.equal(record.data.credit_score, 720);
});

test("F028: list results are redacted per row for a restricted viewer", async () => {
  const client = customRecordClient();
  const result = await listCrmRecords(client, repContext, "custom-records", {});
  assert.equal(result.rows[0].data.notes, "hi");
  assert.equal(Object.prototype.hasOwnProperty.call(result.rows[0].data, "credit_score"), false);
});

test("F028: a restricted user cannot set a role-restricted field on create", async () => {
  const client = customRecordClient();
  await assert.rejects(
    createCrmRecord(client, repContext, "custom-records", {
      objectDefinitionId,
      recordName: "New deal",
      data: { notes: "hi", credit_score: 800 },
    }),
    (error) => error.status === 403 && error.code === "CRM_CUSTOM_FIELD_FORBIDDEN",
  );
});

test("F028: a restricted user can create a record that only sets visible fields", async () => {
  const client = customRecordClient();
  const created = await createCrmRecord(client, repContext, "custom-records", {
    objectDefinitionId,
    recordName: "New deal",
    data: { notes: "hi" },
  });
  assert.equal(created.data.notes, "hi");
});

test("F028: a restricted user cannot change the restricted field via update", async () => {
  const client = customRecordClient();
  await assert.rejects(
    updateCrmRecord(client, repContext, "custom-records", recordId, {
      data: { notes: "updated", credit_score: 999 },
    }),
    (error) => error.status === 403 && error.code === "CRM_CUSTOM_FIELD_FORBIDDEN",
  );
});

test("F028: a restricted user editing an unrelated field is NOT blocked merely because the record already has a restricted field set", async () => {
  const client = customRecordClient();
  const updated = await updateCrmRecord(client, repContext, "custom-records", recordId, {
    recordName: "Renamed deal",
  });
  assert.ok(updated);
  const validationCall = client.calls.find(
    (call) => call.sql.includes("FROM tenant.crm_custom_field_definitions") && call.sql.includes("field_key, data_type"),
  );
  assert.ok(validationCall, "custom record validation still runs");
});
