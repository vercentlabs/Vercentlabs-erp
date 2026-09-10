import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLeadAssigneeAvailability,
  getLeadAssignmentFallback,
  listLeadAssigneeAvailability,
  resolveLeadAssignment,
  setLeadAssigneeAvailability,
  setLeadAssignmentFallback,
} from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-governance.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const ownerA = "33333333-3333-4333-8333-333333333333";
const ownerB = "44444444-4444-4444-8444-444444444444";
const policyId = "55555555-5555-4555-8555-555555555555";
const territoryId = "66666666-6666-4666-8666-666666666666";
const availabilityId = "77777777-7777-4777-8777-777777777777";

const manager = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["crm.view", "crm.leads.manage", "crm.records.view_all"],
  roleSlugs: [],
};

test("F005: round-robin excludes a member currently marked out of office, embedded in the same eligibility query", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_lead_assignment_policies"))
        return { rows: [{ id: policyId, criteria: {}, mode: "round_robin", member_user_ids: [ownerA, ownerB] }] };
      if (sql.includes("unnest($2::uuid[]) WITH ORDINALITY")) {
        assert.match(sql, /crm_lead_assignee_availability/, "the eligibility query itself must exclude unavailable candidates");
        // ownerA is out of office (simulated in the CASE/EXISTS logic); only ownerB is eligible.
        return {
          rows: [
            { user_id: ownerA, is_member: true, user_active: true, name: "A", crm_eligible: true, in_scope: true, out_of_office: true },
            { user_id: ownerB, is_member: true, user_active: true, name: "B", crm_eligible: true, in_scope: true, out_of_office: false },
          ],
        };
      }
      if (sql.includes("DO NOTHING")) return { rows: [] };
      if (sql.includes("SELECT next_index")) return { rows: [{ next_index: 0 }] };
      if (sql.includes("DO UPDATE SET next_index")) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await resolveLeadAssignment(client, manager, {});
  assert.equal(result.ownerUserId, ownerB);
});

test("F005: territory assignment excludes a candidate currently marked out of office in the outer WHERE NOT EXISTS", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_lead_assignment_policies"))
        return { rows: [{ id: policyId, criteria: {}, mode: "territory", territory_id: territoryId }] };
      if (sql.includes("territory_user")) {
        assert.match(sql, /crm_lead_assignee_availability/);
        return { rows: [{ user_id: ownerB }] };
      }
      if (sql.includes("WITH candidate(user_id)"))
        return { rows: [{ user_id: ownerB, active_leads: 0 }] };
      return { rows: [] };
    },
  };
  const result = await resolveLeadAssignment(client, manager, {});
  assert.equal(result.ownerUserId, ownerB);
});

test("F005: no policy matches or produces an owner — the configured, still-eligible fallback owner is used", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_lead_assignment_policies")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_lead_assignment_fallback")) return { rows: [{ fallback_user_id: ownerA }] };
      if (sql.includes("FROM public.organization_memberships membership"))
        return { rows: [{ id: ownerA, name: "Fallback Manager", email: "fallback@example.com" }] };
      return { rows: [] };
    },
  };
  const result = await resolveLeadAssignment(client, manager, {});
  assert.equal(result.ownerUserId, ownerA);
  assert.equal(result.policyId, null);
  assert.equal(result.reason, "fallback_queue");
  assert.equal(result.trace.fallbackUsed, true);
});

test("F005: a configured fallback owner who is no longer eligible falls through to unassigned, not an error", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_lead_assignment_policies")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_lead_assignment_fallback")) return { rows: [{ fallback_user_id: ownerA }] };
      if (sql.includes("FROM public.organization_memberships membership")) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await resolveLeadAssignment(client, manager, {});
  assert.equal(result.ownerUserId, null);
  assert.equal(result.policyId, null);
  assert.equal(result.reason, "unassigned");
});

test("F005: no policies and no fallback configured is unassigned, exactly as before this fix", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_lead_assignment_policies")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_lead_assignment_fallback")) return { rows: [{ fallback_user_id: null }] };
      return { rows: [] };
    },
  };
  const result = await resolveLeadAssignment(client, manager, {});
  assert.equal(result.ownerUserId, null);
  assert.equal(result.policyId, null);
  assert.equal(result.reason, "unassigned");
  assert.equal(result.trace.fallbackUsed, false);
});

test("F005: setLeadAssignmentFallback validates the user is eligible before saving, and clearing needs no eligibility check", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM public.organization_memberships membership")) return { rows: [] }; // not eligible
      if (sql.includes("INSERT INTO tenant.crm_lead_assignment_fallback")) return { rows: [{ organization_id: org, fallback_user_id: values[1] }] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => setLeadAssignmentFallback(client, manager, ownerA),
    (error) => error.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID",
  );
  // Clearing (null) never touches eligibility.
  const cleared = await setLeadAssignmentFallback(client, manager, null);
  assert.equal(cleared.fallback_user_id, null);
});

test("F005: getLeadAssignmentFallback returns a safe empty shape when nothing is configured", async () => {
  const client = { query: async () => ({ rows: [] }) };
  const result = await getLeadAssignmentFallback(client, manager);
  assert.deepEqual(result, { fallback_user_id: null, updated_at: null, fallback_user_name: null, fallback_user_email: null });
});

test("F005: setLeadAssigneeAvailability validates the date range and the assignee's eligibility", async () => {
  const eligibleClient = {
    query: async (sql) => (sql.includes("membership") ? { rows: [{ id: ownerA }] } : { rows: [{ id: availabilityId, user_id: ownerA }] }),
  };
  await assert.rejects(
    () => setLeadAssigneeAvailability(eligibleClient, manager, { userId: "not-a-uuid", startsAt: "2026-01-01", endsAt: "2026-01-02" }),
    (error) => error.code === "CRM_ASSIGNEE_AVAILABILITY_INVALID",
  );
  await assert.rejects(
    () => setLeadAssigneeAvailability(eligibleClient, manager, { userId: ownerA, startsAt: "2026-01-05", endsAt: "2026-01-01" }),
    (error) => error.code === "CRM_ASSIGNEE_AVAILABILITY_INVALID",
  );
  const saved = await setLeadAssigneeAvailability(eligibleClient, manager, {
    userId: ownerA,
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-05T00:00:00Z",
    reason: "Vacation",
  });
  assert.equal(saved.id, availabilityId);
});

test("F005: clearLeadAssigneeAvailability is organization-scoped and 404s on a foreign or missing window", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => clearLeadAssigneeAvailability(client, manager, availabilityId),
    (error) => error.status === 404 && error.code === "CRM_ASSIGNEE_AVAILABILITY_NOT_FOUND",
  );
});

test("F005: listLeadAssigneeAvailability only returns windows that haven't ended yet", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: availabilityId, user_id: ownerA, user_name: "Asha" }] };
    },
  };
  const rows = await listLeadAssigneeAvailability(client, manager);
  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /ends_at>now\(\)/);
  assert.equal(calls[0].values[0], org);
});
