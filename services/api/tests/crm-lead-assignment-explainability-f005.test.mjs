import assert from "node:assert/strict";
import test from "node:test";

import { saveLeadAssignmentPolicy, resolveLeadAssignment, normalizeLeadAssignmentCriteria } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/assignment/assignment-engine.js";
import { explainLeadAssignmentCandidates } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/assignment/eligibility.js";
import { assignLeadOwner } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const territoryId = "33333333-3333-4333-8333-333333333333";
const ownerA = "44444444-4444-4444-8444-444444444444";
const ownerB = "55555555-5555-4555-8555-555555555555";
const leadId = "66666666-6666-4666-8666-666666666666";
const policyId = "77777777-7777-4777-8777-777777777777";

const managerContext = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["crm.view", "crm.leads.manage", "crm.records.view_all", "crm.settings.manage"],
  roleSlugs: [],
};

test("F005: saveLeadAssignmentPolicy now accepts territory mode (previously rejected)", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_territories WHERE organization_id")) return { rows: [{ id: territoryId }] };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
      if (sql.startsWith("SELECT id FROM tenant.crm_lead_assignment_policies")) return { rows: [] };
      if (sql.startsWith("INSERT INTO tenant.crm_lead_assignment_policies"))
        return { rows: [{ id: policyId, mode: "territory", territory_id: territoryId, status: "active" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const saved = await saveLeadAssignmentPolicy(client, managerContext, {
    name: "Territory routing",
    mode: "territory",
    territoryId,
  });
  assert.equal(saved.mode, "territory");
});

test("F005: saveLeadAssignmentPolicy now accepts workload mode (previously rejected)", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM public.organization_memberships membership"))
        return { rows: [{ id: ownerA, name: "A", email: "a@example.com" }] };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
      if (sql.startsWith("SELECT id FROM tenant.crm_lead_assignment_policies")) return { rows: [] };
      if (sql.startsWith("INSERT INTO tenant.crm_lead_assignment_policies"))
        return { rows: [{ id: policyId, mode: "workload", member_user_ids: [ownerA], status: "active" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const saved = await saveLeadAssignmentPolicy(client, managerContext, {
    name: "Workload routing",
    mode: "workload",
    memberUserIds: [ownerA],
  });
  assert.equal(saved.mode, "workload");
});

test("F005: leadGrade is a valid, normalized assignment criterion", () => {
  const normalized = normalizeLeadAssignmentCriteria({ leadGrade: "HOT" });
  assert.equal(normalized.leadGrade, "hot");
  assert.throws(
    () => normalizeLeadAssignmentCriteria({ leadGrade: "scalding" }),
    (error) => error.code === "CRM_ASSIGNMENT_RULE_INVALID",
  );
});

test("F005: explainLeadAssignmentCandidates reports eligible/excluded with reasons for every candidate, not just a filtered subset", async () => {
  const client = {
    async query(sql, values = []) {
      if (sql.includes("unnest($2::uuid[]) WITH ORDINALITY")) {
        return {
          rows: [
            { user_id: ownerA, is_member: true, user_active: true, name: "Priya", crm_eligible: true, in_scope: true, out_of_office: false },
            { user_id: ownerB, is_member: true, user_active: true, name: "Rahul", crm_eligible: false, in_scope: true, out_of_office: false },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const explained = await explainLeadAssignmentCandidates(client, managerContext, [ownerA, ownerB], {});
  assert.equal(explained.length, 2);
  const eligible = explained.find((row) => row.userId === ownerA);
  const excluded = explained.find((row) => row.userId === ownerB);
  assert.equal(eligible.eligible, true);
  assert.deepEqual(eligible.reasons, []);
  assert.equal(excluded.eligible, false);
  assert.deepEqual(excluded.reasons, ["No CRM access"]);
});

test("F005: resolveLeadAssignment's trace records every evaluated policy and every candidate considered", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_lead_assignment_policies"))
        return { rows: [{ id: policyId, criteria: {}, mode: "round_robin", member_user_ids: [ownerA] }] };
      if (sql.includes("unnest($2::uuid[]) WITH ORDINALITY"))
        return { rows: [{ user_id: ownerA, is_member: true, user_active: true, name: "Priya", crm_eligible: true, in_scope: true, out_of_office: false }] };
      if (sql.includes("DO NOTHING")) return { rows: [] };
      if (sql.includes("SELECT next_index")) return { rows: [{ next_index: 0 }] };
      if (sql.includes("DO UPDATE SET next_index")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await resolveLeadAssignment(client, managerContext, {});
  assert.equal(result.ownerUserId, ownerA);
  assert.equal(result.trace.evaluatedPolicies.length, 1);
  assert.equal(result.trace.evaluatedPolicies[0].matched, true);
  assert.equal(result.trace.candidates.length, 1);
  assert.equal(result.trace.candidates[0].eligible, true);
  assert.equal(result.trace.fallbackUsed, false);
});

function assignmentClient() {
  const writes = [];
  return {
    writes,
    async query(sql, values = []) {
      if (sql.includes("SELECT record.* FROM tenant.crm_leads"))
        return { rows: [{ id: leadId, organization_id: org, owner_user_id: ownerA, updated_at: "2026-01-01T00:00:00.000Z", company_id: null, branch_id: null, first_name: "A", last_name: "B" }] };
      if (sql.includes("FROM public.organization_memberships membership")) return { rows: [] }; // ineligible target — triggers override path
      if (sql.startsWith("UPDATE tenant.crm_leads SET owner_user_id")) {
        writes.push({ kind: "lead", sql, values });
        return { rows: [{ id: leadId, owner_user_id: values[2] }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_lead_assignment_events")) {
        writes.push({ kind: "assignment", sql, values });
        return { rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", is_override: values[7] }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) {
        writes.push({ kind: "outbox", sql, values });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO notifications")) {
        writes.push({ kind: "notification", sql, values });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F005 manual override: assigning an otherwise-ineligible owner is rejected without override", async () => {
  const client = assignmentClient();
  await assert.rejects(
    () => assignLeadOwner(client, managerContext, leadId, ownerB, { reason: "manual" }),
    (error) => error.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID",
  );
  assert.equal(client.writes.length, 0);
});

test("F005 manual override: rejected without a reason even when override=true", async () => {
  const client = assignmentClient();
  await assert.rejects(
    () => assignLeadOwner(client, managerContext, leadId, ownerB, { reason: "manual", override: true }),
    (error) => error.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID",
  );
});

test("F005 manual override: rejected when the reason is too short", async () => {
  const client = assignmentClient();
  await assert.rejects(
    () => assignLeadOwner(client, managerContext, leadId, ownerB, { reason: "manual", override: true, overrideReason: "ok" }),
    (error) => error.code === "CRM_LEAD_ASSIGNMENT_OVERRIDE_REASON_REQUIRED",
  );
});

test("F005 manual override: succeeds with override + a real reason, and is recorded as an override with the reason folded into the event reason", async () => {
  const client = assignmentClient();
  const result = await assignLeadOwner(client, managerContext, leadId, ownerB, {
    reason: "manual",
    override: true,
    overrideReason: "Customer specifically requested this rep.",
  });
  assert.equal(result.assignment.changed, true);
  assert.equal(result.assignment.isOverride, true);
  const assignmentWrite = client.writes.find((write) => write.kind === "assignment");
  assert.equal(assignmentWrite.values[7], true); // is_override column
  assert.match(String(assignmentWrite.values[5]), /^override:/); // reason column
});
