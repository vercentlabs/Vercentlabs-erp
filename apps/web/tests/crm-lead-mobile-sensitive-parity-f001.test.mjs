// CRM vNext Prompt 1 — regression coverage for the confirmed mobile Lead
// sensitive-content authorization defect.
//
// Before this fix, apps/web/src/app/api/mobile/v1/crm/[resource]/[id]/route.ts
// fetched a Lead's activities/communications/notes/score history/duplicates
// with raw, unguarded SQL gated only by ordinary crm.leads.view (record-level)
// permission — the same crm.leads.view_sensitive gate the web Lead detail
// page (getLeadDetailData) already enforced for that related content was
// never checked on the mobile surface. The fix routes the mobile route
// through the exact same getLeadDetailData() function web already uses, so
// there is one canonical, reusable projection instead of two independently
// maintained (and silently divergent) implementations.
//
// These tests execute the REAL getLeadDetailData() — via
// tests/helpers/load-server-ts-module.mjs, which lets Node import a
// "server-only" TS module directly — with a mock Postgres client, rather
// than only pattern-matching source text. The mock client still records
// every SQL statement issued so the tests can assert on which sensitive
// queries were (or were not) attempted, in addition to asserting on the
// actual returned data.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadServerTsModule } from "./helpers/load-server-ts-module.mjs";

const { getLeadDetailData, canViewSensitiveLeadContent } = await loadServerTsModule(
  "apps/web/src/modules/crm/server/lead-detail-data.ts",
);

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const otherCompany = "66666666-6666-4666-8666-666666666666";
const branch = "77777777-7777-4777-8777-777777777777";
const otherBranch = "88888888-8888-4888-8888-888888888888";
const owner = "33333333-3333-4333-8333-333333333333";
const leadId = "55555555-5555-4555-8555-555555555555";

function leadRow({ companyId = company, branchId = null, ownerUserId = owner } = {}) {
  return {
    id: leadId,
    organization_id: org,
    company_id: companyId,
    branch_id: branchId,
    owner_user_id: ownerUserId,
    first_name: "Priya",
    last_name: "Match",
    email: "priya@example.com",
    status: "new",
    qualification_state: "not_reviewed",
    record_status: "active",
    updated_at: new Date().toISOString(),
  };
}

// A leadRow's own branch_id defaults to null (branch-less), which the real
// recordScope() treats as visible from any *selected* branch — but a
// context with NO branch selected at all fails closed for anyone without
// allowAllCompanies, regardless of the record. So "valid scope" tests need
// a real activeBranchId selected; branchId is only overridden to test an
// actual branch mismatch.
function baseContext({ sensitive = false, companyId = company, branchId = branch, permissions = [] } = {}) {
  return {
    organizationId: org,
    userId: owner,
    activeCompanyId: companyId,
    activeBranchId: branchId,
    allowAllCompanies: false,
    roleSlugs: [],
    permissions: sensitive ? [...permissions, "crm.leads.view_sensitive"] : permissions,
  };
}

// A single sentinel row per sensitive table, distinguishable from the
// leadRow/duplicate-search fixtures below, so assertions prove real data
// flowed through — not just that *some* row came back.
const sentinelActivity = { id: "activity-1", subject: "Called about renewal", entity_type: "lead", entity_id: leadId };
const sentinelCommunication = { id: "comm-1", body: "Confidential pricing discussion", lead_id: leadId };
const sentinelNote = { id: "note-1", body: "Internal-only note", entity_type: "lead", entity_id: leadId };
const sentinelScoreEvent = { id: "score-1", lead_id: leadId, delta: 10 };
const sentinelAttachment = { id: "attachment-1", file_name: "contract.pdf", entity_type: "crm.lead", entity_id: leadId };
const sentinelAssignmentEvent = { id: "assign-1", reason: "Escalated for high-value deal", previous_owner_user_id: null, new_owner_user_id: owner };

function mockClient(row = leadRow()) {
  const calls = [];
  const matchers = [
    [/FROM tenant\.crm_communications/i, { rows: [sentinelCommunication] }],
    [/FROM tenant\.crm_activities a/i, { rows: [sentinelActivity] }],
    [/FROM tenant\.crm_notes n/i, { rows: [sentinelNote] }],
    [/FROM tenant\.crm_lead_score_history/i, { rows: [sentinelScoreEvent] }],
    [/FROM public\.attachments/i, { rows: [sentinelAttachment] }],
    [/FROM tenant\.crm_lead_assignment_events/i, { rows: [sentinelAssignmentEvent] }],
    [/FROM tenant\.crm_opportunities/i, { rows: [] }],
    [/FROM tenant\.crm_lead_tags/i, { rows: [] }],
    [/crm_normalize_email/i, { rows: [{ email: null, mobile: null, business_phone: null, name: null, company: null }] }],
    [/SELECT user_account\.id/i, { rows: [] }],
  ];
  return {
    calls,
    async query(sql, params = []) {
      calls.push(sql);
      // The Lead record lookup (getCrmRecord's recordScope()) must stay
      // scope-aware so the record-scope-denial tests below exercise the
      // real predicate instead of a mock that always succeeds.
      if (/FROM tenant\.crm_leads/i.test(sql)) {
        const companyMatch = sql.match(/company_id\s*=\s*\$(\d+)\)/);
        if (companyMatch) {
          const bound = params[Number(companyMatch[1]) - 1];
          if (row.company_id != null && row.company_id !== bound) return { rows: [] };
        }
        const branchMatch = sql.match(/branch_id\s*=\s*\$(\d+)\)/);
        if (branchMatch) {
          const bound = params[Number(branchMatch[1]) - 1];
          if (row.branch_id != null && row.branch_id !== bound) return { rows: [] };
        }
        if (/ AND false/.test(sql)) return { rows: [] };
        return { rows: [row] };
      }
      for (const [pattern, result] of matchers) if (pattern.test(sql)) return result;
      return { rows: [], rowCount: 0 };
    },
  };
}

test("F001 mobile parity: canViewSensitiveLeadContent requires the dedicated permission, not ordinary record view", () => {
  assert.equal(canViewSensitiveLeadContent({ permissions: ["crm.leads.manage"], roleSlugs: [] }), false);
  assert.equal(canViewSensitiveLeadContent({ permissions: ["crm.leads.view_sensitive"], roleSlugs: [] }), true);
  assert.equal(canViewSensitiveLeadContent({ permissions: [], roleSlugs: ["organization_owner"] }), true);
});

test("F001 mobile parity: an ordinary viewer (record view but no view_sensitive) receives NO sensitive related content", async () => {
  const client = mockClient();
  const data = await getLeadDetailData(client, baseContext({ sensitive: false, companyId: company }), leadId);

  assert.deepEqual(data.activities, []);
  assert.deepEqual(data.communications, []);
  assert.deepEqual(data.notes, []);
  assert.deepEqual(data.scoreHistory, []);
  assert.deepEqual(data.attachments, []);
  assert.deepEqual(data.duplicates, []);
  assert.equal(data.lead.sensitiveDataRestricted, true);
  assert.equal(data.assignmentHistory[0].reason, null, "assignment reason must be redacted for a non-sensitive viewer even though the event itself is visible");

  // The defect this test guards: before the fix, the mobile route issued
  // these queries unconditionally. Assert the sensitive queries were never
  // even attempted for a non-sensitive viewer — not just that their result
  // was discarded.
  assert.ok(!client.calls.some((sql) => /FROM tenant\.crm_communications/i.test(sql)), "communications must not be queried for a non-sensitive viewer");
  assert.ok(!client.calls.some((sql) => /FROM tenant\.crm_activities a/i.test(sql)), "activities must not be queried for a non-sensitive viewer");
  assert.ok(!client.calls.some((sql) => /FROM tenant\.crm_notes n/i.test(sql)), "notes must not be queried for a non-sensitive viewer");
  assert.ok(!client.calls.some((sql) => /FROM tenant\.crm_lead_score_history/i.test(sql)), "score history must not be queried for a non-sensitive viewer");
  assert.ok(!client.calls.some((sql) => /FROM public\.attachments/i.test(sql)), "attachments must not be queried for a non-sensitive viewer");
  assert.ok(!client.calls.some((sql) => /crm_normalize_email/i.test(sql)), "duplicate matching must not run for a non-sensitive viewer");
});

test("F001 mobile parity: a sensitive viewer (crm.leads.view_sensitive) with valid scope receives the real sensitive related content", async () => {
  const client = mockClient();
  const data = await getLeadDetailData(client, baseContext({ sensitive: true, companyId: company }), leadId);

  assert.equal(data.activities[0]?.id, "activity-1");
  assert.equal(data.communications[0]?.id, "comm-1");
  assert.equal(data.notes[0]?.id, "note-1");
  assert.equal(data.scoreHistory[0]?.id, "score-1");
  assert.equal(data.attachments[0]?.id, "attachment-1");
  assert.equal(data.lead.sensitiveDataRestricted, undefined, "the lead record itself must not carry the restricted marker for an authorized sensitive viewer");
  assert.equal(data.assignmentHistory[0].reason, "Escalated for high-value deal");
});

test("F001 mobile parity: crm.leads.view_sensitive does not bypass company-scope denial (cross-company access stays blocked)", async () => {
  const client = mockClient(leadRow({ companyId: otherCompany, branchId: branch }));
  await assert.rejects(
    getLeadDetailData(client, baseContext({ sensitive: true, companyId: company, branchId: branch }), leadId),
    (error) => error.status === 404,
    "a sensitive-content permission must not let a caller read a Lead outside their active company scope",
  );
});

test("F001 mobile parity: crm.leads.view_sensitive does not bypass branch-scope denial", async () => {
  const client = mockClient(leadRow({ companyId: company, branchId: otherBranch }));
  await assert.rejects(
    getLeadDetailData(client, baseContext({ sensitive: true, companyId: company, branchId: branch }), leadId),
    (error) => error.status === 404,
    "a sensitive-content permission must not let a caller read a Lead outside their active branch scope",
  );
});

test("F001 mobile parity: an ordinary viewer is also blocked by the same cross-company scope gate (record-level and content-level denial compose)", async () => {
  const client = mockClient(leadRow({ companyId: otherCompany, branchId: branch }));
  await assert.rejects(
    getLeadDetailData(client, baseContext({ sensitive: false, companyId: company, branchId: branch }), leadId),
    (error) => error.status === 404,
  );
});

test("F001 mobile parity: the mobile CRM detail route delegates to the canonical getLeadDetailData projection for Leads instead of querying sensitive tables directly", () => {
  const route = fs.readFileSync(
    new URL("../src/app/api/mobile/v1/crm/[resource]/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /import \{ getLeadDetailData \} from "@\/modules\/crm\/server\/lead-detail-data"/);
  assert.match(route, /const detail = await getLeadDetailData\(client, context, id\);/);
  // The old bypass this test guards against: raw, unguarded queries against
  // the sensitive tables inside this route's own GET handler.
  assert.ok(
    !/resource === "leads"[\s\S]{0,400}client\.query\(`SELECT[\s\S]{0,200}tenant\.crm_communications/.test(route),
    "the mobile route must not re-introduce a direct, ungated crm_communications query for leads",
  );
});

test("F001 mobile parity: web's Lead detail page and the mobile Lead detail route both source their response from the same getLeadDetailData function", () => {
  const webPage = fs.readFileSync(new URL("../src/app/(app)/crm/leads/[id]/page.tsx", import.meta.url), "utf8");
  const mobileRoute = fs.readFileSync(
    new URL("../src/app/api/mobile/v1/crm/[resource]/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(webPage, /getLeadDetailData\(client, context, id\)/);
  assert.match(mobileRoute, /getLeadDetailData\(client, context, id\)/);
});
