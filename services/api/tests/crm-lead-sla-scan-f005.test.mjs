import assert from "node:assert/strict";
import test from "node:test";

import { scanLeadSlaBreaches } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js";

const org = "11111111-1111-4111-8111-111111111111";
const leadId = "22222222-2222-4222-8222-222222222222";
const slaCaseId = "33333333-3333-4333-8333-333333333333";
const policyId = "44444444-4444-4444-8444-444444444444";
const escalationUserId = "55555555-5555-4555-8555-555555555555";

const manager = {
  organizationId: org,
  userId: null,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["crm.view", "crm.leads.view_sensitive", "crm.records.view_all", "crm.leads.manage"],
  roleSlugs: ["system_worker"],
};

function breachedCase(overrides = {}) {
  return {
    id: slaCaseId,
    organization_id: org,
    lead_id: leadId,
    policy_id: policyId,
    status: "open",
    response_due_at: "2020-01-01T00:00:00Z",
    first_responded_at: null,
    escalation_user_id: null,
    reassign_on_breach: false,
    ...overrides,
  };
}

function slaScanClient({ openCases = [], leadRow = { id: leadId, organization_id: org, owner_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", company_id: null, branch_id: null } } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_lead_sla_cases sla") && sql.includes("JOIN tenant.crm_lead_sla_policies policy"))
        return { rows: openCases };
      if (sql.startsWith("UPDATE tenant.crm_lead_sla_cases SET status='breached'")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_lead_sla_events")) return { rows: [] };
      if (sql.includes("SELECT record.* FROM tenant.crm_leads record") && sql.includes("FOR UPDATE")) return { rows: [leadRow] };
      if (sql.includes("FROM public.organization_memberships membership") && sql.includes("user_account.id"))
        return { rows: [{ id: escalationUserId, name: "Escalation Manager", email: "escalation@example.com" }] };
      if (sql.startsWith("UPDATE tenant.crm_leads SET owner_user_id")) return { rows: [{ ...leadRow, owner_user_id: escalationUserId }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_assignment_events")) return { rows: [{ id: "event-1" }] };
      if (sql.includes("INSERT INTO tenant.platform_events")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F005: no open/overdue SLA cases is a clean no-op", async () => {
  const client = slaScanClient({ openCases: [] });
  const result = await scanLeadSlaBreaches(client, manager, new Date("2026-01-01T00:00:00Z"));
  assert.deepEqual(result, { scanned: 0, breached: 0 });
});

test("F005: a breach without reassign_on_breach is marked breached but the Lead's owner is untouched", async () => {
  const client = slaScanClient({ openCases: [breachedCase()] });
  const result = await scanLeadSlaBreaches(client, manager, new Date("2026-01-01T00:00:00Z"));
  assert.equal(result.scanned, 1);
  assert.equal(result.breached, 1);
  assert.equal(client.calls.some((call) => call.sql.startsWith("UPDATE tenant.crm_leads SET owner_user_id")), false);
  const events = client.calls.filter((call) => call.sql.includes("INSERT INTO tenant.crm_lead_sla_events"));
  assert.equal(events.length, 1, "only the 'breached' event, no 'reassigned' event");
});

test("F005: a breach with reassign_on_breach and an escalation user reassigns the Lead and records both events", async () => {
  const client = slaScanClient({
    openCases: [breachedCase({ reassign_on_breach: true, escalation_user_id: escalationUserId })],
  });
  const result = await scanLeadSlaBreaches(client, manager, new Date("2026-01-01T00:00:00Z"));
  assert.equal(result.breached, 1);
  const reassign = client.calls.find((call) => call.sql.startsWith("UPDATE tenant.crm_leads SET owner_user_id"));
  assert.ok(reassign, "expected the Lead to actually be reassigned");
  assert.equal(reassign.values[2], escalationUserId);
  const events = client.calls.filter((call) => call.sql.includes("INSERT INTO tenant.crm_lead_sla_events"));
  assert.equal(events.length, 2, "both 'breached' and 'reassigned' events");
});

test("F005: reassign_on_breach without a configured escalation user does not attempt a reassignment", async () => {
  const client = slaScanClient({ openCases: [breachedCase({ reassign_on_breach: true, escalation_user_id: null })] });
  await scanLeadSlaBreaches(client, manager, new Date("2026-01-01T00:00:00Z"));
  assert.equal(client.calls.some((call) => call.sql.startsWith("UPDATE tenant.crm_leads SET owner_user_id")), false);
});

test("F005: without crm.leads.view_sensitive the scan is forbidden, not silently empty", async () => {
  const restricted = { ...manager, roleSlugs: [], permissions: ["crm.view"] };
  await assert.rejects(
    scanLeadSlaBreaches(slaScanClient({ openCases: [] }), restricted),
    (error) => error.status === 403 && error.code === "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
  );
});
