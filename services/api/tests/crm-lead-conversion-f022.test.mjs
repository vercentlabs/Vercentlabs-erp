import assert from "node:assert/strict";
import test from "node:test";

import { updateCrmRecord } from "../src/modules/crm/index.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.records.view_all"],
};

const leadId = "33333333-3333-4333-8333-333333333333";

function clientWithLead(recordStatus) {
  return {
    query: async (sql) => {
      if (sql.includes("SELECT record.*") && sql.includes("FOR UPDATE"))
        return {
          rows: [
            {
              id: leadId,
              record_status: recordStatus,
              status: "converted",
              first_name: "Rahul",
            },
          ],
        };
      assert.fail(`no write is allowed once converted, saw: ${sql.slice(0, 80)}`);
    },
  };
}

test("F022: a converted Lead is read-only through the generic update path", async () => {
  await assert.rejects(
    updateCrmRecord(clientWithLead("converted"), context, "leads", leadId, {
      firstName: "Renamed",
    }),
    (error) => error.status === 409 && error.code === "CRM_LEAD_CONVERTED_READ_ONLY",
  );
  await assert.rejects(
    updateCrmRecord(clientWithLead("converted"), context, "leads", leadId, {
      email: "new-email@example.com",
    }),
    (error) => error.code === "CRM_LEAD_CONVERTED_READ_ONLY",
  );
});

test("F022: an active (not yet converted) Lead remains editable", async () => {
  const client = {
    query: async (sql, values) => {
      if (sql.includes("SELECT record.*") && sql.includes("FOR UPDATE"))
        return { rows: [{ id: leadId, record_status: "active", status: "new", first_name: "Rahul", email: "rahul@example.com" }] };
      if (sql.includes("UPDATE tenant.crm_leads"))
        return { rows: [{ id: leadId, record_status: "active", status: "new", first_name: "Renamed", email: "rahul@example.com" }] };
      if (sql.includes("crm_normalize_email"))
        return { rows: [{ email: "rahul@example.com", mobile: null, business_phone: null, name: "renamed", company: null }] };
      return { rows: [] };
    },
  };
  const updated = await updateCrmRecord(client, context, "leads", leadId, { firstName: "Renamed" });
  assert.equal(updated.firstName, "Renamed");
});
