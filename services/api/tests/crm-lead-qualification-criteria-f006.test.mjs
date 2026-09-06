import assert from "node:assert/strict";
import test from "node:test";

import { createCrmRecord, updateCrmRecord } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const criterionId = "33333333-3333-4333-8333-333333333333";

const manager = {
  organizationId: org,
  userId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.view", "crm.settings.manage"],
};

function criterionRow(overrides = {}) {
  return {
    id: criterionId,
    organization_id: org,
    criterion_key: "website",
    label: "Website",
    tier: "recommended",
    check_type: "non_empty_any",
    field_keys: ["website"],
    sequence: 100,
    status: "active",
    ...overrides,
  };
}

function criteriaClient({ insertRow = criterionRow(), before = criterionRow() } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("INSERT INTO tenant.crm_lead_qualification_criteria"))
        return { rows: [{ ...insertRow, field_keys: values.find((v) => Array.isArray(v)) || insertRow.field_keys }] };
      if (sql.includes("SELECT record.*") && sql.includes("FROM tenant.crm_lead_qualification_criteria"))
        return { rows: [before] };
      if (sql.startsWith("UPDATE tenant.crm_lead_qualification_criteria"))
        return { rows: [{ ...before, field_keys: values.find((v) => Array.isArray(v)) || before.field_keys }] };
      return { rows: [] };
    },
  };
}

test("F006: a comma-separated field key string from the admin form is stored as a real array", async () => {
  const client = criteriaClient();
  const created = await createCrmRecord(client, manager, "qualification-criteria", {
    criterionKey: "website",
    label: "Website",
    tier: "recommended",
    checkType: "non_empty_any",
    fieldKeys: " website , industry ",
  });
  const insert = client.calls.find((call) => call.sql.startsWith("INSERT INTO tenant.crm_lead_qualification_criteria"));
  const boundArray = insert.values.find((v) => Array.isArray(v));
  assert.deepEqual(boundArray, ["website", "industry"]);
  assert.ok(created);
});

test("F006: an unknown Lead field key is rejected with a clear error, not a silent no-op criterion", async () => {
  const client = criteriaClient();
  await assert.rejects(
    createCrmRecord(client, manager, "qualification-criteria", {
      criterionKey: "bogus",
      label: "Bogus",
      tier: "recommended",
      checkType: "non_empty_any",
      fieldKeys: "notARealField",
    }),
    (error) => error.status === 400 && error.code === "CRM_QUALIFICATION_CRITERION_FIELD_INVALID",
  );
});

test("F006: a positive-number criterion cannot reference more than one field", async () => {
  const client = criteriaClient();
  await assert.rejects(
    createCrmRecord(client, manager, "qualification-criteria", {
      criterionKey: "value",
      label: "Value",
      tier: "recommended",
      checkType: "positive_number",
      fieldKeys: "estimatedValue,companyName",
    }),
    (error) => error.status === 400 && error.code === "CRM_QUALIFICATION_CRITERION_FIELD_COUNT_INVALID",
  );
});

test("F006: updating a criterion's field keys re-validates them the same way", async () => {
  const client = criteriaClient();
  await assert.rejects(
    updateCrmRecord(client, manager, "qualification-criteria", criterionId, {
      fieldKeys: "notARealField",
    }),
    (error) => error.code === "CRM_QUALIFICATION_CRITERION_FIELD_INVALID",
  );
});

test("F006: an array of field keys from a direct API caller passes through untouched", async () => {
  const client = criteriaClient();
  await createCrmRecord(client, manager, "qualification-criteria", {
    criterionKey: "website",
    label: "Website",
    tier: "recommended",
    checkType: "non_empty_any",
    fieldKeys: ["website"],
  });
  const insert = client.calls.find((call) => call.sql.startsWith("INSERT INTO tenant.crm_lead_qualification_criteria"));
  assert.deepEqual(insert.values.find((v) => Array.isArray(v)), ["website"]);
});
