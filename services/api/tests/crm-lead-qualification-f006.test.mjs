import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertNoQualificationMutation,
  decideLeadQualification,
  evaluateLeadQualificationReadiness,
  getLeadQualification,
} from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-qualification.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";

const manager = {
  organizationId,
  userId: actorId,
  activeCompanyId: companyId,
  activeBranchId: branchId,
  allowAllCompanies: true,
  permissions: ["crm.view", "crm.leads.manage", "crm.records.view_all"],
  roleSlugs: [],
};

const leadRow = (overrides = {}) => ({
  id: leadId,
  organization_id: organizationId,
  company_id: companyId,
  branch_id: branchId,
  first_name: "Asha",
  email: "asha@example.com",
  status: "working",
  score: -100,
  source_id: "66666666-6666-4666-8666-666666666666",
  owner_user_id: null,
  qualification_state: "not_reviewed",
  qualification_reason_code: null,
  qualification_reason_text: null,
  qualification_note: null,
  qualification_decided_at: null,
  qualification_decided_by_user_id: null,
  ...overrides,
});

// Mirrors migration 083's seeded defaults exactly, so these tests exercise
// the same real-world rules the old hardcoded checklist enforced.
function defaultCriteriaRows() {
  return [
    { criterion_key: "identity", label: "Lead identity", tier: "required", check_type: "non_empty_any", field_keys: ["firstName"] },
    { criterion_key: "contact", label: "Contact method", tier: "required", check_type: "non_empty_any", field_keys: ["email", "mobile", "phone"] },
    { criterion_key: "company", label: "Company", tier: "recommended", check_type: "non_empty_any", field_keys: ["companyName"] },
    { criterion_key: "job_title", label: "Job title", tier: "recommended", check_type: "non_empty_any", field_keys: ["jobTitle"] },
    { criterion_key: "product_interest", label: "Product interest", tier: "recommended", check_type: "non_empty_any", field_keys: ["productInterest"] },
    { criterion_key: "estimated_value", label: "Estimated value", tier: "recommended", check_type: "positive_number", field_keys: ["estimatedValue"] },
    { criterion_key: "source", label: "Lead source", tier: "recommended", check_type: "non_empty_any", field_keys: ["sourceId"] },
  ];
}

function qualificationClient(initial = {}) {
  let current = leadRow(initial);
  const writes = [];
  const history = [];
  return {
    writes,
    history,
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_lead_qualification_criteria"))
        return { rows: defaultCriteriaRows() };
      if (sql.includes("FROM tenant.crm_leads lead"))
        return { rows: [{ ...current, qualification_decided_by_name: current.qualification_decided_by_user_id ? "Manager" : null }] };
      if (sql.includes("FROM tenant.crm_lead_qualification_events event"))
        return { rows: [...history].reverse() };
      if (sql.startsWith("UPDATE tenant.crm_leads")) {
        current = {
          ...current,
          qualification_state: values[2],
          qualification_reason_code: values[3],
          qualification_reason_text: values[4],
          qualification_note: values[5],
          qualification_decided_at: new Date("2026-08-25T10:00:00Z"),
          qualification_decided_by_user_id: values[6],
        };
        writes.push({ kind: "lead", sql, values });
        return { rows: [current] };
      }
      if (sql.includes("INSERT INTO tenant.crm_lead_qualification_events")) {
        const row = {
          id: `${String(history.length + 1).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
          organization_id: values[0],
          lead_id: values[1],
          previous_state: values[2],
          new_state: values[3],
          reason_code: values[4],
          reason_text: values[5],
          note: values[6],
          decided_by_user_id: values[7],
          decided_by_name: "Manager",
          override_used: values[8],
          override_reason: values[9],
          created_at: new Date(`2026-08-25T10:0${history.length}:00Z`),
        };
        history.push(row);
        writes.push({ kind: "history", sql, values });
        return { rows: [row] };
      }
      if (sql.includes("INSERT INTO tenant.platform_events")) {
        writes.push({ kind: "outbox", sql, values });
        return { rows: [] };
      }
      if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_lead_scoring_models")) return { rows: [] }; // no active model — the F027 recalc hook no-ops
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function criteriaOnlyClient() {
  return { query: async (sql) => (sql.includes("crm_lead_qualification_criteria") ? { rows: defaultCriteriaRows() } : { rows: [] }) };
}

test("F006: readiness uses identity and reachability as the only blockers", async () => {
  const readiness = await evaluateLeadQualificationReadiness(criteriaOnlyClient(), manager, {
    first_name: "Asha",
    email: "asha@example.com",
    company_name: "",
    product_interest: "",
    score: -100,
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.required.every((item) => item.met), true);
  assert.equal(readiness.recommended.some((item) => !item.met), true);
});

test("F006: missing identity or every contact method blocks qualification", async () => {
  const readiness = await evaluateLeadQualificationReadiness(criteriaOnlyClient(), manager, { first_name: "" });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.required.map((item) => item.met), [false, false]);
});

test("F006: score alone neither qualifies nor blocks a Lead", async () => {
  const client = criteriaOnlyClient();
  assert.equal((await evaluateLeadQualificationReadiness(client, manager, { first_name: "A", mobile: "1234567", score: -10000 })).ready, true);
  assert.equal((await evaluateLeadQualificationReadiness(client, manager, { first_name: "", score: 10000 })).ready, false);
});

test("F006: an admin-configured criterion is honored without a code change", async () => {
  const client = {
    query: async (sql) =>
      sql.includes("crm_lead_qualification_criteria")
        ? { rows: [{ criterion_key: "website", label: "Website", tier: "required", check_type: "non_empty_any", field_keys: ["website"] }] }
        : { rows: [] },
  };
  const readiness = await evaluateLeadQualificationReadiness(client, manager, { first_name: "Asha", website: null });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.required, [{ key: "website", label: "Website", met: false, help: "Add website." }]);
});

test("F006: a positive-number criterion checks only the first field key", async () => {
  const client = {
    query: async (sql) =>
      sql.includes("crm_lead_qualification_criteria")
        ? { rows: [{ criterion_key: "estimated_value", label: "Estimated value", tier: "recommended", check_type: "positive_number", field_keys: ["estimatedValue"] }] }
        : { rows: [] },
  };
  assert.equal((await evaluateLeadQualificationReadiness(client, manager, { estimated_value: 0 })).recommended[0].met, false);
  assert.equal((await evaluateLeadQualificationReadiness(client, manager, { estimated_value: 500 })).recommended[0].met, true);
});

test("F006: generic mutation fields, including legacy reason, are rejected", () => {
  for (const field of ["qualificationState", "qualificationReasonCode", "qualificationDecidedAt", "unqualifiedReason"])
    assert.throws(
      () => assertNoQualificationMutation({ [field]: "forged" }),
      (error) => error.code === "CRM_LEAD_QUALIFICATION_ACTION_REQUIRED",
    );
  const resourceModel = readFileSync(new URL("../src/modules/crm/index.js", import.meta.url), "utf8");
  const validation = readFileSync(new URL("../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-record-validation.js", import.meta.url), "utf8");
  const operations = readFileSync(new URL("../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-operations.js", import.meta.url), "utf8");
  assert.doesNotMatch(resourceModel, /unqualifiedReason:\s*"unqualified_reason"/);
  assert.doesNotMatch(validation, /unqualifiedReason:\s*2_000/);
  assert.doesNotMatch(operations, /RETURNING[^`]*unqualified_reason/);
});

test("F006: unauthorized qualification fails before a database query", async () => {
  let queries = 0;
  await assert.rejects(
    decideLeadQualification(
      { query: async () => { queries += 1; return { rows: [] }; } },
      { ...manager, permissions: ["crm.view"], roleSlugs: [] },
      leadId,
      { decision: "qualified" },
    ),
    (error) => error.status === 403 && error.code === "CRM_LEAD_QUALIFICATION_FORBIDDEN",
  );
  assert.equal(queries, 0);
});

test("F006: a valid Lead qualifies without changing owner, source, status or score", async () => {
  const client = qualificationClient();
  const result = await decideLeadQualification(client, manager, leadId, {
    decision: "qualified",
    note: "Confirmed commercial requirement",
  });
  assert.equal(result.changed, true);
  assert.equal(result.lead.qualificationState, "qualified");
  assert.equal(result.lead.status, "working");
  assert.equal(result.lead.score, -100);
  assert.equal(result.lead.ownerUserId, null);
  assert.ok(result.lead.sourceId);
  assert.deepEqual(client.writes.map((item) => item.kind), ["lead", "history", "outbox"]);
  assert.equal(client.writes.some((item) => /opportunit|conversion/i.test(item.sql)), false);
});

test("F006: required readiness failures make no writes and return field errors", async () => {
  const client = qualificationClient({ first_name: "", email: null });
  await assert.rejects(
    decideLeadQualification(client, manager, leadId, { decision: "qualified" }),
    (error) =>
      error.code === "CRM_LEAD_QUALIFICATION_NOT_READY" &&
      Boolean(error.details.errors.identity) &&
      Boolean(error.details.errors.contact),
  );
  assert.equal(client.writes.length, 0);
});

test("F006 exception override: overriding without the elevated permission is rejected, even with a reason", async () => {
  const client = qualificationClient({ first_name: "", email: null });
  const rep = { ...manager, permissions: ["crm.view", "crm.leads.manage"] };
  await assert.rejects(
    decideLeadQualification(client, rep, leadId, {
      decision: "qualified",
      overrideUsed: true,
      overrideReason: "Verbal confirmation from the buyer.",
    }),
    (error) => error.code === "CRM_LEAD_QUALIFICATION_OVERRIDE_FORBIDDEN",
  );
  assert.equal(client.writes.length, 0);
});

test("F006 exception override: overriding with permission but no reason is rejected", async () => {
  const client = qualificationClient({ first_name: "", email: null });
  await assert.rejects(
    decideLeadQualification(client, manager, leadId, { decision: "qualified", overrideUsed: true }),
    (error) => error.code === "CRM_LEAD_QUALIFICATION_OVERRIDE_REASON_REQUIRED",
  );
  assert.equal(client.writes.length, 0);
});

test("F006 exception override: an authorized override with a reason qualifies despite missing evidence and is recorded distinctly from an ordinary decision", async () => {
  const client = qualificationClient({ first_name: "", email: null });
  const result = await decideLeadQualification(client, manager, leadId, {
    decision: "qualified",
    overrideUsed: true,
    overrideReason: "Verbal confirmation from the buyer; paperwork to follow.",
  });
  assert.equal(result.changed, true);
  assert.equal(result.lead.qualificationState, "qualified");
  assert.equal(result.event.overrideUsed, true);
  assert.equal(result.event.overrideReason, "Verbal confirmation from the buyer; paperwork to follow.");
});

test("F006: readiness includes an evaluatedAt timestamp and a canOverride flag reflecting the caller's permission", async () => {
  const client = qualificationClient();
  const qualification = await getLeadQualification(client, manager, leadId);
  assert.equal(typeof qualification.evaluatedAt, "string");
  assert.equal(qualification.canOverride, true);
  const rep = { ...manager, permissions: ["crm.view", "crm.leads.manage"] };
  const repQualification = await getLeadQualification(client, rep, leadId);
  assert.equal(repQualification.canOverride, false);
});

test("F006: unqualification requires an enumerated reason and Other details", async () => {
  for (const input of [
    { decision: "unqualified" },
    { decision: "unqualified", reasonCode: "invented" },
    { decision: "unqualified", reasonCode: "other", reasonText: "" },
  ]) {
    const client = qualificationClient();
    await assert.rejects(
      decideLeadQualification(client, manager, leadId, input),
      (error) => error.code === "CRM_LEAD_QUALIFICATION_REASON_REQUIRED",
    );
    assert.equal(client.writes.length, 0);
  }
});

test("F006: qualified to unqualified to requalified preserves ordered history", async () => {
  const client = qualificationClient();
  await decideLeadQualification(client, manager, leadId, { decision: "qualified" });
  await decideLeadQualification(client, manager, leadId, {
    decision: "unqualified",
    reasonCode: "no_current_requirement",
    note: "Review next quarter",
  });
  const result = await decideLeadQualification(client, manager, leadId, {
    decision: "qualified",
  });
  assert.equal(result.qualification.state, "qualified");
  assert.equal(result.qualification.history.length, 3);
  assert.deepEqual(client.writes.filter((item) => item.kind === "outbox").map((item) => item.values[1]), [
    "crm.leads.qualified",
    "crm.leads.unqualified",
    "crm.leads.requalified",
  ]);
});

test("F006: same-state decisions are idempotent with no event or outbox", async () => {
  const client = qualificationClient({
    qualification_state: "qualified",
    qualification_decided_at: new Date(),
    qualification_decided_by_user_id: actorId,
  });
  const result = await decideLeadQualification(client, manager, leadId, { decision: "qualified" });
  assert.equal(result.changed, false);
  assert.equal(client.writes.length, 0);
});

test("F006: archived and converted Leads cannot change qualification", async () => {
  for (const status of ["archived", "converted"]) {
    const client = qualificationClient({ status });
    await assert.rejects(
      decideLeadQualification(client, manager, leadId, { decision: "qualified" }),
      (error) => error.code === "CRM_LEAD_QUALIFICATION_TRANSITION_INVALID",
    );
    assert.equal(client.writes.length, 0);
  }
});

test("F006: scoped reads bind organization, company, branch and owner boundaries", async () => {
  const calls = [];
  const client = qualificationClient();
  const original = client.query.bind(client);
  client.query = async (sql, values) => {
    calls.push({ sql, values });
    return original(sql, values);
  };
  await getLeadQualification(client, { ...manager, allowAllCompanies: false, permissions: ["crm.view", "crm.leads.manage"] }, leadId);
  const scoped = calls[0];
  assert.match(scoped.sql, /company_id/);
  assert.match(scoped.sql, /branch_id/);
  assert.match(scoped.sql, /owner_user_id/);
  assert.deepEqual(scoped.values, [organizationId, leadId, companyId, branchId, actorId]);
});

test("F006: qualifying a Lead fires the lead.qualified automation trigger, unqualifying does not", async () => {
  const calls = [];
  const client = qualificationClient();
  const original = client.query.bind(client);
  client.query = async (sql, values) => {
    calls.push({ sql, values });
    return original(sql, values);
  };
  await decideLeadQualification(client, manager, leadId, { decision: "qualified" });
  const automationCall = calls.find((call) => call.sql.includes("FROM tenant.crm_automation_rules"));
  assert.ok(automationCall);
  assert.deepEqual(automationCall.values, [organizationId, "lead.qualified"]);

  calls.length = 0;
  await decideLeadQualification(client, manager, leadId, {
    decision: "unqualified",
    reasonCode: "no_current_requirement",
  });
  assert.equal(calls.some((call) => call.sql.includes("FROM tenant.crm_automation_rules")), false);
});

test("F006: domain serializes decisions with a row lock before update", () => {
  const source = readFileSync(new URL("../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-qualification.js", import.meta.url), "utf8");
  assert.match(source, /FOR UPDATE OF lead/);
  assert.match(source, /previousState === "unqualified"/);
  assert.match(source, /INSERT INTO tenant\.crm_lead_qualification_events/);
  // The decision event goes through the Shared Platform transactional outbox.
  assert.match(source, /publishDomainEvent\(client/);
  assert.doesNotMatch(source, /createCrmRecord[\s\S]*opportunit/);
});

test("F006: migration separates historical status and enforces decision invariants", () => {
  const migration = readFileSync(
    new URL("../../../database/tenant/migrations/062_crm_lead_qualification_f006.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /qualification_state text NOT NULL DEFAULT 'not_reviewed'/);
  assert.match(migration, /crm_leads_qualification_decision_check/);
  assert.match(migration, /crm_lead_qualification_events/);
  assert.match(migration, /UPDATE tenant\.crm_leads[\s\S]*status = 'working'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
});
