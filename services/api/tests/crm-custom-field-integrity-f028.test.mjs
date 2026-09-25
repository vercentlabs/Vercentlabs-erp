import assert from "node:assert/strict";
import test from "node:test";

import { setCustomFieldValues } from "../src/modules/crm/crm-data-operations-and-customization/custom-field-runtime.js";
import { resolveCrmEntityAccess } from "../src/modules/crm/seller-activity-and-follow-up-workspace/timeline/timeline.js";

// F028 — custom field values: edit permission, correct booleans, required
// fields satisfied by stored values, an append-only history of changes, and
// deal-owner scope on the shared record-access check.

const org = "11111111-1111-4111-8111-111111111111";
const oppId = "55555555-5555-4555-8555-555555555555";
const rep = { organizationId: org, userId: "22222222-2222-4222-8222-222222222222", permissions: ["crm.opportunities.manage", "crm.leads.view_sensitive"], roleSlugs: [] };
const definitions = [
  { id: "d-bool", field_key: "is_strategic", label: "Strategic", data_type: "boolean", required: false, configuration: {} },
  { id: "d-req", field_key: "region", label: "Region", data_type: "select", required: true, configuration: { options: ["West", "North"] } },
];

function client({ stored = [], visible = true } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_opportunities")) return { rows: visible ? [{ id: oppId, company_id: null, branch_id: null }] : [] };
      if (sql.startsWith("SELECT * FROM custom_field_definitions")) return { rows: definitions };
      if (sql.startsWith("SELECT definition_id, value FROM custom_field_values")) return { rows: stored };
      if (sql.includes("INSERT INTO custom_field_value_history")) { writes.push({ kind: "history", values }); return { rows: [] }; }
      if (sql.includes("INSERT INTO custom_field_values")) { writes.push({ kind: "value", values }); return { rows: [] }; }
      if (sql.includes("crm_outbox") || sql.includes("outbox")) return { rows: [] };
      if (sql.includes("FROM custom_field_definitions definition")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F028: a 'false' string stores false (not true), and junk is rejected", async () => {
  const c = client({ stored: [{ definition_id: "d-req", value: "West" }] });
  await setCustomFieldValues(c, rep, "opportunity", oppId, { is_strategic: "false" });
  const value = c.writes.find((w) => w.kind === "value");
  assert.equal(value.values[3], "false", "JSON false");
  await assert.rejects(setCustomFieldValues(client({ stored: [{ definition_id: "d-req", value: "West" }] }), rep, "opportunity", oppId, { is_strategic: "maybe" }), (e) => e.code === "CRM_CUSTOM_FIELD_VALUE_INVALID");
});

test("F028: saving one field does not demand re-sending a required field that already has a value", async () => {
  await setCustomFieldValues(client({ stored: [{ definition_id: "d-req", value: "West" }] }), rep, "opportunity", oppId, { is_strategic: true });
  await assert.rejects(setCustomFieldValues(client({ stored: [] }), rep, "opportunity", oppId, { is_strategic: true }), (e) => e.code === "CRM_CUSTOM_FIELD_VALUE_REQUIRED");
});

test("F028: each real change is written to the append-only history with previous and new value; unchanged values are not", async () => {
  const c = client({ stored: [{ definition_id: "d-req", value: "West" }] });
  await setCustomFieldValues(c, rep, "opportunity", oppId, { region: "North", is_strategic: true });
  const history = c.writes.filter((w) => w.kind === "history");
  assert.equal(history.length, 2);
  const region = history.find((h) => h.values[4] === "region");
  assert.equal(region.values[6], JSON.stringify("West"));
  assert.equal(region.values[7], JSON.stringify("North"));
  const same = client({ stored: [{ definition_id: "d-req", value: "West" }] });
  await setCustomFieldValues(same, rep, "opportunity", oppId, { region: "West" });
  assert.equal(same.writes.filter((w) => w.kind === "history").length, 0);
});

test("F028: writing values needs the record type's manage permission", async () => {
  const viewer = { ...rep, permissions: ["crm.leads.view_sensitive"] };
  await assert.rejects(setCustomFieldValues(client(), viewer, "opportunity", oppId, { is_strategic: true }), (e) => e.code === "CRM_CUSTOM_FIELD_EDIT_FORBIDDEN");
});

test("F028: the shared record check applies deal-owner scope for callers without view-all", async () => {
  let captured;
  const c = { async query(sql, values) { captured = { sql, values }; return { rows: [] }; } };
  const allowed = await resolveCrmEntityAccess(c, rep, "opportunity", oppId);
  assert.equal(allowed, false);
  // Own + managed-team members + unassigned — the shared rule (crm-access-scope.js).
  assert.match(captured.sql, /AND \(opportunity\.owner_user_id IS NULL OR opportunity\.owner_user_id = \$3 OR EXISTS \(SELECT 1 FROM tenant\.crm_sales_team_members/);
  // The team subquery is correlated to the deal's own organization, never an unqualified column.
  assert.match(captured.sql, /team_member\.organization_id=opportunity\.organization_id/);
  assert.equal(captured.values[2], rep.userId);
});
