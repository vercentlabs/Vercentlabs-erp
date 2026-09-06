import assert from "node:assert/strict";
import test from "node:test";

import { createCrmRecord, updateCrmRecord } from "../src/modules/crm/index.js";
import { normalizeLeadRecordInput } from "../src/modules/crm/features/leads/record-validation.js";

const org = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const otherSourceId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";

const manager = {
  organizationId: org,
  userId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.view", "crm.leads.manage", "crm.records.view_all"],
};

function leadRow(overrides = {}) {
  return {
    id: leadId,
    organization_id: org,
    first_name: "Asha",
    email: "asha@example.com",
    source_id: sourceId,
    original_source_id: sourceId,
    referrer_name: null,
    owner_user_id: userId,
    status: "new",
    score: 0,
    ...overrides,
  };
}

function creationClient({ insertRow = leadRow() } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT tenant.crm_normalize_email"))
        return { rows: [{ email: "asha@example.com", mobile: null, business_phone: null, name: "asha", company: null }] };
      if (sql.includes("SELECT pg_advisory_xact_lock")) return { rows: [{}] };
      if (sql.includes("FROM tenant.crm_leads") && sql.includes("normalized_email"))
        return { rows: [] };
      if (sql.includes("SELECT id,name,status FROM tenant.crm_lead_sources"))
        return { rows: [{ id: sourceId, name: "Website", status: "active" }] };
      if (sql.startsWith("UPDATE public.numbering_series"))
        return { rows: [{ prefix: "LEAD-", number: 1, padding: 5 }] };
      if (sql.startsWith("SELECT field_name, operator")) return { rows: [] };
      if (sql.startsWith("SELECT user_id FROM public.organization_memberships"))
        return { rows: [{ user_id: userId }] };
      if (sql.includes("FROM public.organization_memberships membership"))
        return { rows: [{ id: userId, name: "Asha", email: "asha@example.com" }] };
      if (sql.startsWith("INSERT INTO tenant.crm_leads"))
        return { rows: [insertRow] };
      if (sql.includes("INSERT INTO tenant.crm_lead_score_history")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_lead_assignment_events"))
        return {
          rows: [{
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            lead_id: insertRow.id,
            previous_owner_user_id: null,
            new_owner_user_id: insertRow.owner_user_id,
            reason: "manual:create",
          }],
        };
      return { rows: [] };
    },
  };
}

test("F004: a new Lead's original source is forced to mirror its initial source, ignoring any caller-supplied value", async () => {
  const client = creationClient();
  await createCrmRecord(client, manager, "leads", {
    firstName: "Asha",
    email: "asha@example.com",
    sourceId,
    // an attacker/buggy client trying to fabricate a different original source
    originalSourceId: otherSourceId,
  });
  const insert = client.calls.find((call) => call.sql.startsWith("INSERT INTO tenant.crm_leads"));
  assert.equal(insert.values.includes(otherSourceId), false);
  assert.equal(insert.values.filter((v) => v === sourceId).length >= 2, true, "sourceId and originalSourceId both bind the same value");
});

test("F004: a Lead created with no source has no original source either", async () => {
  const client = creationClient({ insertRow: leadRow({ source_id: null, original_source_id: null }) });
  await createCrmRecord(client, manager, "leads", { firstName: "Asha", email: "asha@example.com" });
  const insert = client.calls.find((call) => call.sql.startsWith("INSERT INTO tenant.crm_leads"));
  assert.match(insert.sql, /original_source_id/);
});

test("F004: referrerName is accepted on create and persisted", async () => {
  const client = creationClient({ insertRow: leadRow({ referrer_name: "Rahul Sharma" }) });
  const created = await createCrmRecord(client, manager, "leads", {
    firstName: "Asha",
    email: "asha@example.com",
    sourceId,
    referrerName: "  Rahul Sharma  ",
  });
  assert.equal(created.referrerName, "Rahul Sharma");
  const insert = client.calls.find((call) => call.sql.startsWith("INSERT INTO tenant.crm_leads"));
  assert.match(insert.sql, /referrer_name/);
  assert.equal(insert.values.includes("Rahul Sharma"), true);
});

test("F004: original source cannot be edited through the generic update path", async () => {
  const client = {
    calls: [],
    async query(sql, values = []) {
      this.calls.push({ sql, values });
      if (sql.includes("SELECT record.*") && sql.includes("FOR UPDATE")) return { rows: [leadRow()] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    updateCrmRecord(client, manager, "leads", leadId, { originalSourceId: otherSourceId }),
    (error) => error.status === 409 && error.code === "CRM_LEAD_ORIGINAL_SOURCE_IMMUTABLE",
  );
  assert.equal(
    client.calls.some((call) => call.sql.startsWith("UPDATE tenant.crm_leads")),
    false,
    "rejected before the record is ever written",
  );
});

test("F004: normalizeLeadRecordInput trims referrerName and maps blank to null", () => {
  assert.deepEqual(normalizeLeadRecordInput({ referrerName: "  Rahul Sharma  " }), { referrerName: "Rahul Sharma" });
  assert.deepEqual(normalizeLeadRecordInput({ referrerName: "   " }), { referrerName: null });
});
