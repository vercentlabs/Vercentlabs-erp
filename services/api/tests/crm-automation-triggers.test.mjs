import assert from "node:assert/strict";
import test from "node:test";

import { updateCrmRecord } from "../src/modules/crm/index.js";

// Module-wide gap surfaced by F015's audit: crm_automation_rules.event_type
// allows 7 values, but 3 (lead.updated, lead.qualified,
// campaign.member_responded) had no synchronous call site anywhere in the
// mutation code paths. lead.qualified is covered in
// crm-lead-qualification-f006.test.mjs and campaign.member_responded is
// covered (via source assertion, given how deep createCrmRecord's pipeline
// is) in crm-public-capture.test.mjs. This file covers lead.updated.

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

function trackingLeadClient() {
  const calls = [];
  return {
    calls,
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.includes("SELECT record.*") && sql.includes("FOR UPDATE"))
        return {
          rows: [{
            id: leadId,
            record_status: "active",
            status: "new",
            first_name: "Rahul",
            email: "rahul@example.com",
            owner_user_id: null,
          }],
        };
      if (sql.includes("UPDATE tenant.crm_leads"))
        return {
          rows: [{
            id: leadId,
            record_status: "active",
            status: "new",
            first_name: "Renamed",
            email: "rahul@example.com",
            owner_user_id: null,
          }],
        };
      if (sql.includes("crm_normalize_email"))
        return { rows: [{ email: "rahul@example.com", mobile: null, business_phone: null, name: "renamed", company: null }] };
      if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("automation: an actual field change on a Lead fires the lead.updated trigger", async () => {
  const client = trackingLeadClient();
  const updated = await updateCrmRecord(client, context, "leads", leadId, { firstName: "Renamed" });
  assert.equal(updated.firstName, "Renamed");
  const automationCall = client.calls.find((call) => call.sql.includes("FROM tenant.crm_automation_rules"));
  assert.ok(automationCall, "expected the lead.updated automation trigger to run");
  assert.deepEqual(automationCall.values, [context.organizationId, "lead.updated"]);
});

test("automation: an owner-only reassignment through the generic path does not double-fire lead.updated", async () => {
  const client = {
    calls: [],
    query: async function (sql, values = []) {
      this.calls.push({ sql, values });
      if (sql.includes("SELECT record.*") && sql.includes("FOR UPDATE"))
        return { rows: [{ id: leadId, record_status: "active", status: "new", first_name: "Rahul", email: "rahul@example.com", owner_user_id: "44444444-4444-4444-8444-444444444444" }] };
      if (sql.includes("FROM public.organization_memberships membership"))
        return { rows: [{ id: "55555555-5555-4555-8555-555555555555", name: "New Owner", email: "new@example.com" }] };
      if (sql.startsWith("UPDATE tenant.crm_leads SET owner_user_id"))
        return { rows: [{ id: leadId, record_status: "active", status: "new", first_name: "Rahul", email: "rahul@example.com", owner_user_id: "55555555-5555-4555-8555-555555555555" }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_assignment_events")) return { rows: [{ id: "66666666-6666-4666-8666-666666666666" }] };
      return { rows: [] };
    },
  };
  const updated = await updateCrmRecord(client, context, "leads", leadId, {
    ownerUserId: "55555555-5555-4555-8555-555555555555",
  });
  assert.equal(updated.ownerUserId, "55555555-5555-4555-8555-555555555555");
  assert.equal(
    client.calls.some((call) => call.sql.includes("FROM tenant.crm_automation_rules") && call.values[1] === "lead.updated"),
    false,
    "a pure owner change is already covered by crm.leads.assigned; it should not also fire lead.updated",
  );
});
