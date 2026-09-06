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

const fieldDefinitionId = "55555555-5555-4555-8555-555555555555";

function fieldDefinitionClient({ before = null, gapCount = 0 } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("count(*)::int AS count") && sql.includes("crm_custom_records"))
        return { rows: [{ count: gapCount }] };
      if (before && sql.includes("SELECT record.*") && sql.includes("FROM tenant.crm_custom_field_definitions"))
        return { rows: [before] };
      if (sql.startsWith("INSERT INTO tenant.crm_custom_field_definitions"))
        return { rows: [{ id: fieldDefinitionId, ...Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v])) }] };
      if (sql.startsWith("UPDATE tenant.crm_custom_field_definitions"))
        return { rows: [{ id: fieldDefinitionId, object_definition_id: objectDefinitionId, field_key: before?.field_key, required: true }] };
      return { rows: [] };
    },
  };
}

test("F028: marking a field required is blocked when existing active records have no value for it", async () => {
  const client = fieldDefinitionClient({ gapCount: 12 });
  await assert.rejects(
    createCrmRecord(client, managerContext, "custom-field-definitions", {
      objectDefinitionId,
      fieldKey: "industry",
      label: "Industry",
      dataType: "text",
      required: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_CUSTOM_FIELD_REQUIRED_ROLLOUT_GAP" && error.details.missing === 12,
  );
});

test("F028: confirmRequiredRollout proceeds despite the gap, and a zero gap needs no confirmation", async () => {
  const confirmed = await createCrmRecord(fieldDefinitionClient({ gapCount: 12 }), managerContext, "custom-field-definitions", {
    objectDefinitionId,
    fieldKey: "industry",
    label: "Industry",
    dataType: "text",
    required: true,
    confirmRequiredRollout: true,
  });
  assert.ok(confirmed);

  const noGap = await createCrmRecord(fieldDefinitionClient({ gapCount: 0 }), managerContext, "custom-field-definitions", {
    objectDefinitionId,
    fieldKey: "industry",
    label: "Industry",
    dataType: "text",
    required: true,
  });
  assert.ok(noGap);
});

test("F028: rollout safety only fires when required actually transitions from false to true", async () => {
  const alreadyRequired = { id: fieldDefinitionId, object_definition_id: objectDefinitionId, field_key: "industry", required: true, data_type: "text" };
  const client = fieldDefinitionClient({ before: alreadyRequired, gapCount: 999 });
  const updated = await updateCrmRecord(client, managerContext, "custom-field-definitions", fieldDefinitionId, {
    label: "Renamed label",
  });
  assert.ok(updated);
  assert.equal(client.calls.some((call) => call.sql.includes("count(*)::int AS count") && call.sql.includes("crm_custom_records")), false);
});

test("F028: rollout safety fires on the update path when required flips from false to true", async () => {
  const notYetRequired = { id: fieldDefinitionId, object_definition_id: objectDefinitionId, field_key: "industry", required: false, data_type: "text" };
  const client = fieldDefinitionClient({ before: notYetRequired, gapCount: 3 });
  await assert.rejects(
    updateCrmRecord(client, managerContext, "custom-field-definitions", fieldDefinitionId, { required: true }),
    (error) => error.code === "CRM_CUSTOM_FIELD_REQUIRED_ROLLOUT_GAP" && error.details.missing === 3,
  );
});

function dependentOptionClient({ existingData = {} } = {}) {
  const fields = [
    { field_key: "country", data_type: "select", required: false, unique_value: false, options: ["India", "USA"], validation: {}, visible_to_roles: null, depends_on_field_key: null },
    {
      field_key: "state",
      data_type: "select",
      required: false,
      unique_value: false,
      options: { India: ["Maharashtra", "Karnataka"], USA: ["California", "Texas"] },
      validation: {},
      visible_to_roles: null,
      depends_on_field_key: "country",
    },
  ];
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_custom_object_definitions"))
        return { rows: [{ id: objectDefinitionId, company_scoped: false }] };
      if (sql.includes("FROM tenant.crm_custom_field_definitions") && sql.includes("depends_on_field_key"))
        return { rows: fields };
      if (sql.includes("INSERT INTO tenant.crm_custom_records"))
        return { rows: [{ id: recordId, object_definition_id: objectDefinitionId, data: values.find((v) => v && typeof v === "object" && !Array.isArray(v)) || existingData }] };
      return { rows: [] };
    },
  };
}

test("F028: a dependent picklist accepts a value valid for the parent field's current selection", async () => {
  const client = dependentOptionClient();
  const created = await createCrmRecord(client, managerContext, "custom-records", {
    objectDefinitionId,
    recordName: "Acme HQ",
    data: { country: "India", state: "Maharashtra" },
  });
  assert.equal(created.data.state, "Maharashtra");
});

test("F028: a dependent picklist rejects a value that belongs to a different parent value", async () => {
  const client = dependentOptionClient();
  await assert.rejects(
    createCrmRecord(client, managerContext, "custom-records", {
      objectDefinitionId,
      recordName: "Acme HQ",
      data: { country: "India", state: "Texas" },
    }),
    (error) => error.status === 400 && error.code === "CRM_CUSTOM_FIELD_OPTION_INVALID",
  );
});

test("F028: a dependent picklist rejects any value while its parent field is unset", async () => {
  const client = dependentOptionClient();
  await assert.rejects(
    createCrmRecord(client, managerContext, "custom-records", {
      objectDefinitionId,
      recordName: "Acme HQ",
      data: { state: "Maharashtra" },
    }),
    (error) => error.status === 400 && error.code === "CRM_CUSTOM_FIELD_OPTION_INVALID",
  );
});
