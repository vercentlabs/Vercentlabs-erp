import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLeadInput,
  findLeadDuplicates,
  resolveLeadOwner,
} from "../src/crm/lead-governance.js";
const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
};
test("required lead fields are server governed", async () => {
  const client = {
    query: async (sql) =>
      sql.includes("record_types")
        ? { rows: [{ id: "r", key: "standard" }] }
        : sql.includes("field_definitions")
          ? {
              rows: [
                {
                  field_key: "first_name",
                  label: "First name",
                  data_type: "text",
                  storage: "standard",
                  standard_column: "firstName",
                  required: true,
                },
              ],
            }
          : sql.includes("lead_layouts")
            ? { rows: [{ validation_rules: [] }] }
            : { rows: [] },
  };
  const r = await validateLeadInput(client, context, {});
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].field, "first_name");
});
test("duplicate query stays tenant scoped", async () => {
  let values;
  const client = {
    query: async (_sql, v) => {
      values = v;
      return { rows: [] };
    },
  };
  await findLeadDuplicates(client, context, { email: "A@B.COM" });
  assert.equal(values[0], context.organizationId);
  assert.equal(values[1], "a@b.com");
});
test("round robin is deterministic", async () => {
  let n = 0;
  const client = {
    query: async (sql) =>
      sql.includes("assignment_policies")
        ? {
            rows: [
              {
                id: "p",
                criteria: {},
                mode: "round_robin",
                member_user_ids: ["u1", "u2"],
              },
            ],
          }
        : { rows: [{ next_index: ++n }] },
  };
  assert.equal(await resolveLeadOwner(client, context, {}), "u1");
});
