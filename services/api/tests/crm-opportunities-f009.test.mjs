import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  archiveCrmRecord,
  createCrmRecord,
  getCrmRecord,
  listCrmRecords,
  updateCrmRecord,
} from "../src/modules/crm/index.js";
import {
  normalizeOpportunityRecordInput,
  validateOpportunityRecord,
} from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-record-validation.js";

const root = path.resolve(import.meta.dirname, "../../..");
const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const otherUser = "44444444-4444-4444-8444-444444444444";
const pipeline = "55555555-5555-4555-8555-555555555555";
const otherPipeline = "66666666-6666-4666-8666-666666666666";
const stage = "77777777-7777-4777-8777-777777777777";
const opportunity = "88888888-8888-4888-8888-888888888888";
const party = "99999999-9999-4999-8999-999999999999";
const contact = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const context = {
  organizationId: org,
  userId: user,
  activeCompanyId: company,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

const manager = {
  ...context,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: [...context.permissions, "crm.records.view_all"],
};

function currentOpportunity(overrides = {}) {
  return {
    id: opportunity,
    organization_id: org,
    company_id: company,
    branch_id: null,
    code: "OPP-00001",
    pipeline_id: pipeline,
    stage_id: stage,
    owner_user_id: user,
    name: "Acme ERP rollout",
    description: null,
    amount: "1000.00",
    currency_code: "INR",
    probability: "20.00",
    expected_close_date: null,
    actual_close_date: null,
    status: "open",
    forecast_category: "pipeline",
    next_step: null,
    outcome_reason_id: null,
    outcome_notes: null,
    lost_reason_id: null,
    loss_notes: null,
    ...overrides,
  };
}

// Stage A2 Prompt 3 live-browser QA fix: getCrmRecord/listCrmRecords now
// batch-resolve stageName/partyName/contactName/ownerName for opportunities
// (resource-query-service.js's annotateOpportunityRelations) — a real gap
// found and closed this pass, not a test-only concern. Every mock below
// that reads an opportunity now also receives these 4 lookup queries;
// this shared matcher lets each mock opt in with one line rather than
// repeating the same 4 branches. Returns null (not a response) when the
// SQL doesn't match one of the 4 new queries, so callers can fall through
// to their own "Unexpected query" throw for anything genuinely unexpected.
function opportunityRelationMockResponse(sql) {
  if (sql.startsWith("SELECT id, name FROM tenant.crm_pipeline_stages")) return { rows: [] };
  if (sql.startsWith("SELECT id, display_name FROM tenant.business_parties")) return { rows: [] };
  if (sql.startsWith("SELECT id, first_name, last_name FROM tenant.contacts")) return { rows: [] };
  if (sql.startsWith("SELECT id, full_name FROM public.users")) return { rows: [] };
  return null;
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("F009: Opportunity name is required and normalized", () => {
  assert.equal(validateOpportunityRecord({ name: "   " }, { mode: "create" })[0].code, "CRM_OPPORTUNITY_NAME_REQUIRED");
  const normalized = normalizeOpportunityRecordInput({ name: "  Acme rollout  ", currencyCode: " inr ", amount: "25.50", nextStep: "  Call CFO  " });
  assert.equal(normalized.name, "Acme rollout");
  assert.equal(normalized.currencyCode, "INR");
  assert.equal(normalized.amount, 25.5);
  assert.equal(normalized.nextStep, "Call CFO");
});

test("F009: invalid amount, currency, close date and references fail at the domain boundary", () => {
  const issues = validateOpportunityRecord({
    name: "Valid",
    amount: -1,
    currencyCode: "RUPEE",
    expectedCloseDate: "2026-02-31",
    partyId: "not-a-uuid",
  }, { mode: "create" });
  assert.deepEqual(new Set(issues.map((item) => item.code)), new Set([
    "CRM_OPPORTUNITY_AMOUNT_INVALID",
    "CRM_OPPORTUNITY_CURRENCY_INVALID",
    "CRM_OPPORTUNITY_CLOSE_DATE_INVALID",
    "CRM_OPPORTUNITY_REFERENCE_INVALID",
  ]));
});

test("F009: create cannot begin won/lost/archived or inject outcome fields", async () => {
  for (const payload of [
    { name: "Won at birth", status: "won" },
    { name: "Injected close", actualCloseDate: "2026-08-26" },
    { name: "Injected reason", outcomeReasonId: party },
  ]) {
    await assert.rejects(
      () => createCrmRecord({ query: async () => assert.fail("must fail before DB") }, context, "opportunities", payload),
      (error) => error.code === "CRM_OPPORTUNITY_LIFECYCLE_GOVERNED",
    );
  }
});

test("F009: stage and pipeline must be a coherent active pair", async () => {
  let calls = 0;
  const client = {
    async query(sql) {
      calls += 1;
      if (sql.includes("UPDATE public.numbering_series")) return { rows: [{ prefix: "OPP-", number: 1, padding: 5 }] };
      if (sql.includes("FROM tenant.crm_pipeline_stages s") && sql.includes("s.id=$2"))
        return { rows: [{ stage_id: stage, pipeline_id: pipeline, probability: "20", forecast_category: "pipeline", pipeline_company_id: company }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => createCrmRecord(client, manager, "opportunities", { name: "Mismatch", pipelineId: otherPipeline, stageId: stage }),
    (error) => error.code === "CRM_OPPORTUNITY_STAGE_PIPELINE_MISMATCH",
  );
  assert.equal(calls, 2);
});

test("F009: manual create defaults to actor ownership and derives probability/forecast from stage", async () => {
  let insertedValues = null;
  let outboxPayload = null;
  const client = {
    async query(sql, values = []) {
      if (sql.includes("UPDATE public.numbering_series")) return { rows: [{ prefix: "OPP-", number: 2, padding: 5 }] };
      if (sql.includes("FROM tenant.crm_pipelines p") && sql.includes("ORDER BY (p.company_id=$2)"))
        return { rows: [{ stage_id: stage, pipeline_id: pipeline, probability: "35", forecast_category: "best_case", pipeline_company_id: company }] };
      if (sql.includes("FROM public.organization_memberships membership") && sql.includes("membership.user_id=$2"))
        return { rows: [{ id: user, name: "Seller", email: "seller@example.test" }] };
      if (sql.startsWith("INSERT INTO tenant.crm_opportunities")) {
        insertedValues = values;
        return { rows: [currentOpportunity({ id: opportunity, probability: "35.00", forecast_category: "best_case", name: "New opportunity" })] };
      }
      if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) { outboxPayload = values[4]; return { rows: [] }; }
      if (sql.includes("SELECT user_id FROM public.organization_memberships") && sql.includes("ANY($2::uuid[])")) return { rows: [{ user_id: user }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const created = await createCrmRecord(client, manager, "opportunities", { name: "New opportunity", amount: 1000, currencyCode: "inr" });
  assert.equal(created.id, opportunity);
  assert.ok(insertedValues.includes(user), "actor must be persisted as owner when form owner is blank");
  assert.ok(insertedValues.includes(35), "stage-derived probability must be persisted");
  assert.ok(insertedValues.includes("best_case"), "stage-derived forecast category must be persisted");
  assert.equal(outboxPayload.id, opportunity);
  assert.equal(outboxPayload.ownerUserId, user);
  assert.equal("name" in outboxPayload, false, "outbox must use the minimal Opportunity snapshot");
  assert.equal("description" in outboxPayload, false);
});

test("F009: owner must be an active CRM-eligible member for the selected scope", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("UPDATE public.numbering_series")) return { rows: [{ prefix: "OPP-", number: 3, padding: 5 }] };
      if (sql.includes("FROM tenant.crm_pipelines p") && sql.includes("ORDER BY (p.company_id=$2)"))
        return { rows: [{ stage_id: stage, pipeline_id: pipeline, probability: "10", forecast_category: "pipeline", pipeline_company_id: company }] };
      if (sql.includes("FROM public.organization_memberships membership") && sql.includes("membership.user_id=$2")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => createCrmRecord(client, manager, "opportunities", { name: "Wrong owner", ownerUserId: otherUser }),
    (error) => error.code === "CRM_OPPORTUNITY_OWNER_INELIGIBLE",
  );
});

test("F009: Contact and Account must describe one customer relationship", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("UPDATE public.numbering_series")) return { rows: [{ prefix: "OPP-", number: 4, padding: 5 }] };
      if (sql.includes("FROM tenant.crm_pipelines p") && sql.includes("ORDER BY (p.company_id=$2)"))
        return { rows: [{ stage_id: stage, pipeline_id: pipeline, probability: "10", forecast_category: "pipeline", pipeline_company_id: company }] };
      if (sql.includes("FROM tenant.contacts c") && sql.includes("JOIN tenant.business_parties p"))
        return { rows: [{ id: contact, party_id: otherPipeline, status: "active", company_id: company, party_status: "active" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => createCrmRecord(client, manager, "opportunities", { name: "Relationship mismatch", partyId: party, contactId: contact }),
    (error) => error.code === "CRM_OPPORTUNITY_CONTACT_ACCOUNT_MISMATCH",
  );
});

test("F009: archived Opportunities are read-only", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return { rows: [currentOpportunity({ status: "archived" })] };
      const related = opportunityRelationMockResponse(sql);
      if (related) return related;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => updateCrmRecord(client, context, "opportunities", opportunity, { name: "Should fail" }),
    (error) => error.code === "CRM_OPPORTUNITY_ARCHIVED",
  );
});

test("F009: outcome and stage-owned fields cannot be forged through generic PATCH", async () => {
  for (const payload of [
    { stageId: otherPipeline },
    { probability: 99 },
    { status: "won" },
    { actualCloseDate: "2026-08-26" },
    { outcomeNotes: "forged" },
  ]) {
    const client = {
      async query(sql) {
        if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return { rows: [currentOpportunity()] };
        const related = opportunityRelationMockResponse(sql);
        if (related) return related;
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    await assert.rejects(
      () => updateCrmRecord(client, manager, "opportunities", opportunity, payload),
      /Use governed Opportunity actions/,
    );
  }
});

test("F009: restricted rep cannot make an Opportunity unowned", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return { rows: [currentOpportunity()] };
      const related = opportunityRelationMockResponse(sql);
      if (related) return related;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => updateCrmRecord(client, context, "opportunities", opportunity, { ownerUserId: null }),
    (error) => error.code === "CRM_OPPORTUNITY_OWNER_REQUIRED",
  );
});

test("F009: repeated archive is idempotent and emits no second event", async () => {
  // getCrmRecord's "before" fetch now also batch-resolves stageName/
  // ownerName (annotateOpportunityRelations) for every opportunity read,
  // archived or not — real, read-only SELECTs, not the UPDATE/outbox this
  // test is actually about. Tracked separately so the assertion stays
  // precise to its own stated intent rather than an incidental call count.
  let mutatingCalls = 0;
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return { rows: [currentOpportunity({ status: "archived" })] };
      const related = opportunityRelationMockResponse(sql);
      if (related) return related;
      if (sql.startsWith("UPDATE") || sql.startsWith("INSERT")) mutatingCalls += 1;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await archiveCrmRecord(client, manager, "opportunities", opportunity);
  assert.equal(result.status, "archived");
  assert.equal(mutatingCalls, 0, "idempotent archive must not issue an UPDATE/outbox on replay");
});

test("F009: changing scope revalidates existing Account relationships", async () => {
  const otherCompany = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
        return { rows: [currentOpportunity({ party_id: party })] };
      if (sql.includes("FROM tenant.business_parties"))
        return { rows: [{ id: party, company_id: company, status: "active" }] };
      const related = opportunityRelationMockResponse(sql);
      if (related) return related;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => updateCrmRecord(client, { ...manager, activeCompanyId: null }, "opportunities", opportunity, { companyId: otherCompany }),
    (error) => error.code === "CRM_OPPORTUNITY_RELATION_SCOPE_INVALID",
  );
});

test("F009: Account cannot be cleared while its Contact remains linked", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
        return { rows: [currentOpportunity({ party_id: party, contact_id: contact })] };
      if (sql.includes("FROM tenant.contacts c") && sql.includes("JOIN tenant.business_parties p"))
        return { rows: [{ id: contact, party_id: party, status: "active", company_id: company, party_status: "active" }] };
      const related = opportunityRelationMockResponse(sql);
      if (related) return related;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => updateCrmRecord(client, manager, "opportunities", opportunity, { partyId: null }),
    (error) => error.code === "CRM_OPPORTUNITY_CONTACT_ACCOUNT_REQUIRED",
  );
});

test("F009: ordinary descriptive edits do not revalidate unchanged relationships", async () => {
  let relationshipQueries = 0;
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
        return { rows: [currentOpportunity({ party_id: party, contact_id: contact })] };
      const related = opportunityRelationMockResponse(sql);
      if (related) return related;
      if (sql.includes("FROM tenant.contacts c") || sql.includes("FROM tenant.business_parties")) {
        relationshipQueries += 1;
        throw new Error("relationship validation should not run for a description-only update");
      }
      if (sql.startsWith("UPDATE tenant.crm_opportunities record SET"))
        return { rows: [currentOpportunity({ party_id: party, contact_id: contact, description: "Updated" })] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const updated = await updateCrmRecord(client, manager, "opportunities", opportunity, { description: "Updated" });
  assert.equal(updated.description, "Updated");
  assert.equal(relationshipQueries, 0);
});

test("Stage A2 Prompt 3: getCrmRecord/listCrmRecords resolve stageName/partyName/contactName/ownerName for opportunities, not just the raw *Id columns", async () => {
  // Real gap found via live-browser QA: apps/web's Opportunity types.ts had
  // carried these fields since an earlier pass with an honest "not
  // independently verified" comment — the backend never actually projected
  // them, so every Opportunity list row and 360 page showed "Stage —"/
  // "Account —" even when stage_id/party_id were genuinely set. This test
  // proves the fix: a mock that returns real name rows for the 4 new
  // batch-lookup queries must produce populated *Name fields, not raw ids.
  const stageName = "Qualification";
  const partyName = "Acme Corp";
  const contactName = "Jane Doe";
  const ownerName = "Priya Rep";
  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
        return { rows: [currentOpportunity({ party_id: party, contact_id: contact })] };
      if (sql.startsWith("SELECT id, name FROM tenant.crm_pipeline_stages")) return { rows: [{ id: stage, name: stageName }] };
      if (sql.startsWith("SELECT id, display_name FROM tenant.business_parties")) return { rows: [{ id: party, display_name: partyName }] };
      if (sql.startsWith("SELECT id, first_name, last_name FROM tenant.contacts")) return { rows: [{ id: contact, first_name: "Jane", last_name: "Doe" }] };
      if (sql.startsWith("SELECT id, full_name FROM public.users")) return { rows: [{ id: user, full_name: ownerName }] };
      if (sql.includes("count(*)::int AS total")) return { rows: [{ total: 1 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const record = await getCrmRecord(client, manager, "opportunities", opportunity);
  assert.equal(record.stageName, stageName);
  assert.equal(record.partyName, partyName);
  assert.equal(record.contactName, contactName);
  assert.equal(record.ownerName, ownerName);

  const list = await listCrmRecords(client, manager, "opportunities", {});
  assert.equal(list.rows[0].stageName, stageName);
  assert.equal(list.rows[0].ownerName, ownerName);
});

test("Stage A2 Prompt 3: a null stageId/partyId/contactId/ownerUserId resolves to a null *Name, never a lookup for a nonexistent id", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
        return { rows: [currentOpportunity({ party_id: null, contact_id: null, owner_user_id: null })] };
      if (sql.startsWith("SELECT id, name FROM tenant.crm_pipeline_stages")) return { rows: [{ id: stage, name: "Qualification" }] };
      // No business_parties/contacts/users branch: a null id must never be
      // batched into the ANY($N::uuid[]) lookup for that table at all.
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const record = await getCrmRecord(client, manager, "opportunities", opportunity);
  assert.equal(record.stageName, "Qualification");
  assert.equal(record.partyName, null);
  assert.equal(record.contactName, null);
  assert.equal(record.ownerName, null);
});

test("F009 migration enforces stage/pipeline coherence without introducing a new subsystem", () => {
  const migration = read("database/tenant/migrations/065_crm_opportunities_f009.sql");
  assert.match(migration, /crm_opportunities_stage_pipeline_f009_fkey/);
  assert.match(migration, /FOREIGN KEY \(organization_id,pipeline_id,stage_id\)/);
  assert.match(migration, /crm_opportunities_name_nonblank_f009/);
  assert.match(migration, /crm_opportunities_f009_scope_idx/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS tenant\.crm_opportunities/);
});
