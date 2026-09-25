import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assignLeadOwner,
  createCrmRecord,
  updateCrmRecord,
} from "../src/modules/crm/index.js";
import {
  assertEligibleLeadAssignee,
  listEligibleLeadAssignees,
  normalizeLeadAssignmentCriteria,
  resolveLeadAssignment,
  saveLeadAssignmentPolicy,
  setLeadAssignmentPolicyStatus,
} from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-governance.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";
const ownerA = "66666666-6666-4666-8666-666666666666";
const ownerB = "77777777-7777-4777-8777-777777777777";
const policyId = "88888888-8888-4888-8888-888888888888";
const sourceId = "99999999-9999-4999-8999-999999999999";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const manager = {
  organizationId,
  userId: actorId,
  activeCompanyId: companyId,
  activeBranchId: branchId,
  allowAllCompanies: true,
  permissions: ["crm.view", "crm.leads.manage", "crm.leads.view_sensitive", "crm.records.view_all"],
  roleSlugs: [],
};

const rep = {
  ...manager,
  allowAllCompanies: false,
  permissions: ["crm.view", "crm.leads.manage", "crm.leads.view_sensitive"],
};

const leadRow = (ownerUserId = ownerA) => ({
  id: leadId,
  organization_id: organizationId,
  company_id: companyId,
  branch_id: branchId,
  owner_user_id: ownerUserId,
  first_name: "Asha",
  email: "asha@example.com",
  status: "new",
  score: 0,
});

test("F005: assignment criteria are allowlisted, normalized and non-executable", () => {
  assert.deepEqual(
    normalizeLeadAssignmentCriteria({
      sourceId: ` ${sourceId} `,
      countryCode: "in",
      industry: " Manufacturing ",
    }),
    { sourceId, countryCode: "IN", industry: "Manufacturing" },
  );
  for (const criteria of [
    [],
    { arbitrarySql: "SELECT 1" },
    { sourceId: "not-a-uuid" },
    { countryCode: "IND" },
    { industry: "   " },
  ])
    assert.throws(
      () => normalizeLeadAssignmentCriteria(criteria),
      (error) => error.code === "CRM_ASSIGNMENT_RULE_INVALID",
    );
});

test("F005: eligible assignee discovery is organization/scoped, searchable and paginated", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("count(*)::int AS total"))
        return { rows: [{ total: 1 }] };
      return {
        rows: [{ id: ownerA, name: "Priya Shah", email: "priya@example.com" }],
      };
    },
  };
  const result = await listEligibleLeadAssignees(client, manager, {
    search: "priya",
    limit: 500,
    offset: 7,
  });
  assert.equal(result.total, 1);
  assert.equal(result.limit, 50);
  assert.equal(result.offset, 7);
  assert.deepEqual(result.items[0], {
    id: ownerA,
    name: "Priya Shah",
    email: "priya@example.com",
  });
  assert.equal(
    calls.every((call) => call.values[0] === organizationId),
    true,
  );
  assert.equal(calls[0].values.includes(companyId), true);
  assert.equal(calls[0].values.includes(branchId), true);
  assert.match(calls[0].sql, /membership\.status='active'/);
  assert.match(calls[0].sql, /user_account\.status='active'/);
  assert.match(calls[0].sql, /permission_key='crm\.view'/);
});

test("F005: inactive, removed, cross-org or CRM-ineligible assignees fail closed", async () => {
  let queries = 0;
  const client = {
    async query(sql, values) {
      queries += 1;
      assert.match(sql, /organization_memberships/);
      assert.equal(values[0], organizationId);
      return { rows: [] };
    },
  };
  await assert.rejects(
    assertEligibleLeadAssignee(client, manager, ownerA, {
      companyId,
      branchId,
    }),
    (error) =>
      error.status === 409 &&
      error.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID" &&
      !String(error.message).includes(ownerA),
  );
  assert.equal(queries, 1);
});

test("F005: an unauthorized representative cannot assign and no query runs", async () => {
  let queries = 0;
  await assert.rejects(
    assignLeadOwner({ query: async () => (queries += 1) }, rep, leadId, ownerB),
    (error) =>
      error.status === 403 && error.code === "CRM_LEAD_ASSIGNMENT_FORBIDDEN",
  );
  assert.equal(queries, 0);
});

test("F005: malformed assignee identifiers fail before the database", async () => {
  let queries = 0;
  await assert.rejects(
    assignLeadOwner(
      { query: async () => (queries += 1) },
      manager,
      leadId,
      "not-a-uuid",
    ),
    (error) =>
      error.status === 400 && error.code === "CRM_LEAD_ASSIGNEE_NOT_FOUND",
  );
  assert.equal(queries, 0);
});

function assignmentClient({ currentOwner = ownerA } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, values = []) {
      if (sql.includes("SELECT record.* FROM tenant.crm_leads"))
        return { rows: [leadRow(currentOwner)] };
      if (sql.includes("FROM public.organization_memberships membership"))
        return {
          rows: [
            { id: ownerB, name: "Rahul Patil", email: "rahul@example.com" },
          ],
        };
      if (sql.startsWith("UPDATE tenant.crm_leads SET owner_user_id")) {
        writes.push({ kind: "lead", sql, values });
        return { rows: [leadRow(values[2])] };
      }
      if (sql.includes("INSERT INTO tenant.crm_lead_assignment_events")) {
        writes.push({ kind: "assignment", sql, values });
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              lead_id: leadId,
              previous_owner_user_id: values[2],
              new_owner_user_id: values[3],
              policy_id: values[4],
              reason: values[5],
              evaluation_trace: values[6],
              is_override: values[7],
              created_by: values[8],
              created_at: new Date("2026-08-25T10:00:00Z"),
            },
          ],
        };
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

test("F005: authorized reassignment changes the canonical owner and emits exactly one safe event", async () => {
  const client = assignmentClient();
  const result = await assignLeadOwner(client, manager, leadId, ownerB, {
    reason: "manual:test",
  });
  assert.equal(result.lead.ownerUserId, ownerB);
  assert.equal(result.assignment.changed, true);
  assert.equal(result.assignment.previousOwnerUserId, ownerA);
  assert.equal(result.assignment.owner.name, "Rahul Patil");
  assert.deepEqual(
    client.writes.map((write) => write.kind),
    ["lead", "assignment", "outbox", "notification"],
  );
  const outbox = client.writes.find((write) => write.kind === "outbox");
  assert.equal(outbox.values[1], "crm.leads.assigned");
  assert.deepEqual(outbox.values[4], {
    leadId,
    previousOwnerUserId: ownerA,
    ownerUserId: ownerB,
    policyId: null,
    reason: "manual:test",
    isOverride: false,
  });
  assert.equal(
    JSON.stringify(outbox.values[4]).includes("@example.com"),
    false,
  );
});

test("F005: assigning the existing owner is an event-free idempotent no-op", async () => {
  const client = assignmentClient();
  const result = await assignLeadOwner(client, manager, leadId, ownerA);
  assert.equal(result.assignment.changed, false);
  assert.equal(client.writes.length, 0);
});

test("F005: generic owner-only update invokes the assignment domain path", async () => {
  const client = assignmentClient();
  const updated = await updateCrmRecord(client, manager, "leads", leadId, {
    ownerUserId: ownerB,
  });
  assert.equal(updated.ownerUserId, ownerB);
  assert.deepEqual(
    client.writes.map((write) => write.kind),
    ["lead", "assignment", "outbox", "notification"],
  );
});

test("F005: restricted generic PATCH cannot bypass ownership authorization", async () => {
  const client = assignmentClient({ currentOwner: actorId });
  await assert.rejects(
    updateCrmRecord(client, rep, "leads", leadId, { ownerUserId: ownerB }),
    (error) => error.status === 403,
  );
  assert.equal(client.writes.length, 0);
});

test("F005: ineligible (not an org member) fixed owners are skipped and deterministic fallback wins", async () => {
  const policyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const policyB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_lead_assignment_policies"))
        return {
          rows: [
            {
              id: policyA,
              sequence: 10,
              criteria: { sourceId },
              mode: "fixed",
              assignee_user_id: ownerA,
            },
            {
              id: policyB,
              sequence: 100,
              criteria: {},
              mode: "fixed",
              assignee_user_id: ownerB,
            },
          ],
        };
      if (sql.includes("FROM public.organization_memberships membership"))
        return values[1] === ownerB
          ? {
              rows: [{ id: ownerB, name: "Rahul", email: "rahul@example.com" }],
            }
          : { rows: [] };
      if (sql.includes("FROM tenant.crm_lead_assignee_availability")) return { rows: [] }; // available
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await resolveLeadAssignment(client, manager, {
    sourceId,
    companyId,
    branchId,
  });
  assert.equal(result.ownerUserId, ownerB);
  assert.equal(result.policyId, policyB);
  assert.equal(result.reason, "policy:fixed");
  assert.match(calls[0].sql, /ORDER BY sequence,id FOR UPDATE/);
});

test("F005: round robin initializes and row-locks canonical state before advancing", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_lead_assignment_policies"))
        return {
          rows: [
            {
              id: policyId,
              criteria: {},
              mode: "round_robin",
              member_user_ids: [ownerA, ownerB],
            },
          ],
        };
      if (sql.includes("unnest($2::uuid[]) WITH ORDINALITY"))
        return {
          rows: [
            { user_id: ownerA, is_member: true, user_active: true, name: "A", crm_eligible: true, in_scope: true, out_of_office: false },
            { user_id: ownerB, is_member: true, user_active: true, name: "B", crm_eligible: true, in_scope: true, out_of_office: false },
          ],
        };
      if (sql.includes("DO NOTHING")) return { rows: [] };
      if (sql.includes("SELECT next_index"))
        return { rows: [{ next_index: 1 }] };
      if (sql.includes("DO UPDATE SET next_index")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await resolveLeadAssignment(client, manager, {
    companyId,
    branchId,
  });
  assert.equal(result.ownerUserId, ownerB);
  assert.equal(
    calls.some((call) => /FOR UPDATE/.test(call.sql)),
    true,
  );
  const advance = calls.find((call) =>
    call.sql.includes("DO UPDATE SET next_index"),
  );
  assert.equal(advance.values[2], 0);
});

test("F005: rule writes reject unsafe modes/conditions and serialize duplicate names", async () => {
  await assert.rejects(
    // A territory rule without a territory is valid since F020 coverage
    // matching (it routes each lead to its own territory); an unknown mode
    // is still refused before anything is written.
    saveLeadAssignmentPolicy({ query: async () => assert.fail() }, manager, {
      name: "Nearest office",
      mode: "nearest_office",
      assigneeUserId: ownerA,
    }),
    (error) => error.code === "CRM_ASSIGNMENT_RULE_INVALID",
  );
  await assert.rejects(
    saveLeadAssignmentPolicy({ query: async () => assert.fail() }, manager, {
      name: "Unsafe",
      mode: "fixed",
      criteria: { sql: "SELECT 1" },
      assigneeUserId: ownerA,
    }),
    (error) => error.code === "CRM_ASSIGNMENT_RULE_INVALID",
  );

  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM public.organization_memberships membership"))
        return {
          rows: [{ id: ownerA, name: "Priya", email: "priya@example.com" }],
        };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
      if (sql.startsWith("SELECT id FROM tenant.crm_lead_assignment_policies"))
        return { rows: [] };
      if (sql.startsWith("INSERT INTO tenant.crm_lead_assignment_policies"))
        return {
          rows: [
            {
              id: policyId,
              name: "Default assignment",
              mode: "fixed",
              assignee_user_id: ownerA,
              status: "active",
            },
          ],
        };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const saved = await saveLeadAssignmentPolicy(client, manager, {
    name: "Default assignment",
    sequence: 100,
    criteria: {},
    mode: "fixed",
    assigneeUserId: ownerA,
  });
  assert.equal(saved.id, policyId);
  const lockIndex = calls.findIndex((call) =>
    call.sql.includes("pg_advisory_xact_lock"),
  );
  const duplicateIndex = calls.findIndex((call) =>
    call.sql.startsWith("SELECT id FROM tenant.crm_lead_assignment_policies"),
  );
  assert.equal(lockIndex > -1 && lockIndex < duplicateIndex, true);
});

test("F005: deactivation is soft and never rewrites existing Leads", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT * FROM tenant.crm_lead_assignment_policies"))
        return {
          rows: [{ id: policyId, mode: "fixed", assignee_user_id: ownerA }],
        };
      if (sql.startsWith("UPDATE tenant.crm_lead_assignment_policies"))
        return { rows: [{ id: policyId, mode: "fixed", status: "inactive" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await setLeadAssignmentPolicyStatus(
    client,
    manager,
    policyId,
    "inactive",
    "2024-01-01T00:00:00.000Z",
  );
  assert.equal(result.status, "inactive");
  assert.equal(
    calls.some((call) => call.sql.includes("UPDATE tenant.crm_leads")),
    false,
  );
});

test("F005 (Stage A2 §14): updating an existing assignment policy without expectedUpdatedAt is rejected", async () => {
  const client = {
    async query(sql) {
      if (sql.startsWith("SELECT updated_at FROM tenant.crm_lead_assignment_policies"))
        return { rows: [{ updated_at: new Date("2024-01-01T00:00:00.000Z") }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    saveLeadAssignmentPolicy(client, manager, {
      id: policyId,
      name: "Default assignment",
      mode: "fixed",
      assigneeUserId: ownerA,
    }),
    (error) => error.code === "CRM_ASSIGNMENT_RULE_VERSION_REQUIRED",
  );
});

test("F005 (Stage A2 §14): a concurrently-changed assignment policy is rejected as a stale write, not silently overwritten", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT updated_at FROM tenant.crm_lead_assignment_policies"))
        return { rows: [{ updated_at: new Date("2024-01-01T00:00:00.000Z") }] };
      if (sql.includes("FROM public.organization_memberships membership"))
        return { rows: [{ id: ownerA, name: "Priya", email: "priya@example.com" }] };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [{}] };
      if (sql.startsWith("SELECT id FROM tenant.crm_lead_assignment_policies")) return { rows: [] };
      // Simulates a concurrent editor having already changed the row: the
      // UPDATE's own date_trunc guard finds no matching row.
      if (sql.startsWith("UPDATE tenant.crm_lead_assignment_policies")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    saveLeadAssignmentPolicy(client, manager, {
      id: policyId,
      name: "Default assignment",
      sequence: 100,
      criteria: {},
      mode: "fixed",
      assigneeUserId: ownerA,
      expectedUpdatedAt: "2024-01-01T00:00:00.000Z",
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
  const updateCall = calls.find((call) => call.sql.startsWith("UPDATE tenant.crm_lead_assignment_policies"));
  assert.ok(updateCall.sql.includes("date_trunc"));
});

test("F005 (Stage A2 §14): activating/deactivating an assignment policy without expectedUpdatedAt is rejected", async () => {
  const client = {
    async query(sql) {
      if (sql.startsWith("SELECT * FROM tenant.crm_lead_assignment_policies"))
        return { rows: [{ id: policyId, mode: "fixed", assignee_user_id: ownerA }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    setLeadAssignmentPolicyStatus(client, manager, policyId, "inactive"),
    (error) => error.code === "CRM_ASSIGNMENT_RULE_VERSION_REQUIRED",
  );
});

test("F005: explicit create owner is persisted instead of being discarded", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT tenant.crm_normalize_email"))
        return {
          rows: [
            {
              email: String(values[0] || "").trim().toLowerCase() || null,
              mobile: String(values[1] || "").replace(/[^0-9+]/g, "") || null,
              business_phone:
                String(values[2] || "").replace(/[^0-9+]/g, "") || null,
              name: [values[3], values[4]]
                .filter(Boolean)
                .join(" ")
                .trim()
                .toLowerCase() || null,
              company: String(values[5] || "").trim().toLowerCase() || null,
            },
          ],
        };
      if (sql.includes("SELECT pg_advisory_xact_lock")) return { rows: [{}] };
      if (
        sql.includes("FROM tenant.crm_leads") &&
        sql.includes("normalized_email") &&
        sql.includes("normalized_mobile")
      )
        return { rows: [] };
      // ensureDefaultLeadStages' existence check — five rows (any content)
      // is enough to make it a no-op for this test, since it only acts
      // when zero stages exist or the catalogue classifies as the
      // untouched 3-stage legacy default.
      if (sql.includes("SELECT code,name,description,sort_order,status,is_system,is_initial,dwell_warning_hours,dwell_breach_hours") && sql.includes("FROM tenant.crm_lead_stages"))
        return { rows: [{ code: "new" }, { code: "attempting" }, { code: "contacted" }, { code: "working" }, { code: "nurturing" }] };
      if (sql.startsWith("UPDATE public.numbering_series"))
        return { rows: [{ prefix: "LEAD-", number: 1, padding: 5 }] };
      if (sql.includes("FROM public.organization_memberships membership"))
        return {
          rows: [{ id: ownerA, name: "Priya", email: "priya@example.com" }],
        };
      if (sql.startsWith("SELECT field_name, operator")) return { rows: [] };
      if (sql.startsWith("SELECT user_id FROM public.organization_memberships"))
        return { rows: [{ user_id: ownerA }] };
      if (sql.startsWith("INSERT INTO tenant.crm_leads"))
        return {
          rows: [{ ...leadRow(ownerA), id: leadId, code: "LEAD-00001" }],
        };
      if (sql.includes("INSERT INTO tenant.crm_lead_score_history"))
        return { rows: [] };
      if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_lead_assignment_events"))
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              lead_id: leadId,
              previous_owner_user_id: null,
              new_owner_user_id: ownerA,
              reason: "manual:create",
            },
          ],
        };
      if (sql.includes("INSERT INTO notifications")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_lead_scoring_models")) return { rows: [] }; // no active model — recalculateLeadScoreInternal no-ops
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const created = await createCrmRecord(client, manager, "leads", {
    firstName: "Asha",
    email: "asha@example.com",
    ownerUserId: ownerA,
  });
  assert.equal(created.ownerUserId, ownerA);
  const insert = calls.find((call) =>
    call.sql.startsWith("INSERT INTO tenant.crm_leads"),
  );
  assert.match(insert.sql, /owner_user_id/);
  assert.equal(insert.values.includes(ownerA), true);
});

test("F005: offline and SLA entry points delegate to the canonical assignment domain", () => {
  const offline = read("../src/modules/crm/crm-data-operations-and-customization/offline-sync.js");
  const intelligence = read("../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js");
  const slaRoute = read(
    "../../../apps/web/src/app/api/crm/leads/sla/route.ts",
  );
  assert.match(offline, /createCrmRecord\(client, context, "leads"/);
  assert.doesNotMatch(offline, /INSERT INTO tenant\.crm_leads/);
  assert.match(intelligence, /assignLeadOwner\(/);
  assert.match(intelligence, /reason: "sla:breach"/);
  assert.doesNotMatch(
    intelligence,
    /UPDATE tenant\.crm_leads SET owner_user_id/,
  );
  assert.match(slaRoute, /CRM_PERMISSIONS\.recordsViewAll/);
});
