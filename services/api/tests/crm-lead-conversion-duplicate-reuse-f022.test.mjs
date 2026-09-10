import assert from "node:assert/strict";
import test from "node:test";

import { convertCrmLead } from "../src/modules/crm/index.js";

// F022 CAP-002 / F008 reuse: convertCrmLead's Account/Contact resolution
// must go through the SAME governed duplicate engine
// (findAccountDuplicates/findContactDuplicates) every other Account/Contact
// path uses, and must only auto-reuse a candidate whose matched signal is
// configured 'blocking' (classification 'exact') — a merely 'probable'
// match (e.g. a fuzzy/non-blocking name match) must not silently attach a
// converted Lead to someone else's Account/Contact.

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
const existingPartyId = "44444444-4444-4444-8444-444444444444";
const existingContactId = "55555555-5555-4555-8555-555555555555";
const newPartyId = "66666666-6666-4666-8666-666666666666";
const newContactId = "77777777-7777-4777-8777-777777777777";

function baseLeadRow() {
  return {
    id: leadId,
    record_status: "active",
    company_name: "Acme Co",
    full_name: "Rahul Sharma",
    first_name: "Rahul",
    last_name: "Sharma",
    job_title: "Buyer",
    email: "rahul@example.com",
    phone: null,
    mobile: "9876543210",
    company_id: null,
    branch_id: null,
    campaign_id: null,
    source_id: null,
    owner_user_id: null,
    estimated_value: 1000,
    currency_code: "INR",
  };
}

function accountRulesRow({ blocking }) {
  return {
    entity_type: "account",
    signal: "legal_name",
    method: "normalized",
    weight: 35,
    fuzzy_threshold: null,
    enabled: true,
    blocking,
  };
}

function contactRulesRow({ blocking }) {
  return {
    entity_type: "contact",
    signal: "email",
    method: "exact",
    weight: 70,
    fuzzy_threshold: null,
    enabled: true,
    blocking,
  };
}

function makeClient({ accountBlocking, contactBlocking }) {
  const calls = [];
  return {
    calls,
    query: async (sql, values = []) => {
      calls.push(sql);
      if (sql.includes("FROM tenant.crm_leads") && sql.includes("FOR UPDATE"))
        return { rows: [baseLeadRow()] };
      if (sql.includes("SELECT * FROM tenant.crm_conversion_records"))
        return { rows: [] };
      if (sql.includes("FROM tenant.crm_duplicate_rules")) {
        const entityType = values[1];
        if (entityType === "account")
          return { rows: [accountRulesRow({ blocking: accountBlocking })] };
        if (entityType === "contact")
          return { rows: [contactRulesRow({ blocking: contactBlocking })] };
        return { rows: [] };
      }
      if (sql.includes("FROM tenant.business_parties party")) {
        // Simulates postgres having already computed match_score/matched_signals
        // per the rule row above (legal_name matched, weight 35).
        return {
          rows: [
            {
              id: existingPartyId,
              code: "CUST-0001",
              display_name: "Acme Co",
              legal_name: "Acme Co",
              gstin: null,
              pan: null,
              party_type: "customer",
              status: "active",
              match_score: 35,
              matched_signals: ["legal_name"],
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO tenant.business_parties"))
        return { rows: [{ id: newPartyId }] };
      if (sql.includes("FROM tenant.contacts contact")) {
        return {
          rows: [
            {
              id: existingContactId,
              party_id: existingPartyId,
              first_name: "Rahul",
              last_name: "Sharma",
              email: "rahul@example.com",
              mobile: "9876543210",
              phone: null,
              designation: "Buyer",
              account_name: "Acme Co",
              match_score: 70,
              matched_signals: ["email"],
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO tenant.contacts"))
        return { rows: [{ id: newContactId }] };
      if (sql.includes("public.numbering_series"))
        return { rows: [{ prefix: "CUST-", number: 2, padding: 4 }] };
      if (sql.includes("UPDATE tenant.crm_leads")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_conversion_records"))
        return {
          rows: [
            {
              organization_id: context.organizationId,
              lead_id: leadId,
              party_id: values[2],
              contact_id: values[3],
              opportunity_id: null,
              converted_by: context.userId,
              input_snapshot: {},
            },
          ],
        };
      if (sql.includes("crm_campaign_members")) return { rows: [] };
      if (sql.includes("crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query in test mock: ${sql.slice(0, 120)}`);
    },
  };
}

test("F022: an 'exact' (blocking-rule) Account/Contact duplicate is reused, not recreated", async () => {
  const client = makeClient({ accountBlocking: true, contactBlocking: true });
  const result = await convertCrmLead(client, context, leadId, {
    createOpportunity: false,
  });
  assert.equal(result.partyId, existingPartyId);
  assert.equal(result.contactId, existingContactId);
  assert.ok(!client.calls.some((sql) => sql.includes("INSERT INTO tenant.business_parties")));
  assert.ok(!client.calls.some((sql) => sql.includes("INSERT INTO tenant.contacts")));
});

test("F022: a merely 'probable' (non-blocking) match does not silently reuse another Account/Contact", async () => {
  const client = makeClient({ accountBlocking: false, contactBlocking: false });
  const result = await convertCrmLead(client, context, leadId, {
    createOpportunity: false,
  });
  assert.equal(result.partyId, newPartyId);
  assert.equal(result.contactId, newContactId);
  assert.ok(client.calls.some((sql) => sql.includes("INSERT INTO tenant.business_parties")));
  assert.ok(client.calls.some((sql) => sql.includes("INSERT INTO tenant.contacts")));
});

test("F022: an explicit input.partyId/contactId always wins over duplicate-engine resolution", async () => {
  const client = makeClient({ accountBlocking: false, contactBlocking: false });
  const result = await convertCrmLead(client, context, leadId, {
    createOpportunity: false,
    partyId: existingPartyId,
    contactId: existingContactId,
  });
  assert.equal(result.partyId, existingPartyId);
  assert.equal(result.contactId, existingContactId);
  assert.ok(!client.calls.some((sql) => sql.includes("FROM tenant.business_parties party")));
  assert.ok(!client.calls.some((sql) => sql.includes("FROM tenant.contacts contact")));
});
