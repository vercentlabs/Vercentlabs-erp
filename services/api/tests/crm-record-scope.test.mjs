import assert from "node:assert/strict";
import test from "node:test";

import {
  listCrmRecords,
  getCrmRecord,
  updateCrmRecord,
  archiveCrmRecord,
  createCrmRecord,
  getCrmDashboard,
  getCrmReport,
  findCrmDuplicates,
} from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333"; // the lead's actual owner
const otherUser = "44444444-4444-4444-8444-444444444444"; // a different, unrelated rep

function baseContext(userId, permissions) {
  return {
    organizationId: org,
    userId,
    activeCompanyId: company,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: [],
    permissions,
  };
}

// Sales Representative: crm.leads.manage but NOT crm.records.view_all — the
// exact real-world role Prompt 1 flagged as having no ownership scoping.
const repPermissions = ["crm.view", "crm.leads.manage", "crm.opportunities.manage", "crm.activities.manage"];
const ownerContext = baseContext(owner, repPermissions);
const otherRepContext = baseContext(otherUser, repPermissions);
// Sales Manager: same base permissions plus crm.records.view_all.
const managerContext = baseContext(otherUser, [...repPermissions, "crm.records.view_all"]);

const leadId = "55555555-5555-4555-8555-555555555555";
const ownedLead = {
  id: leadId,
  organization_id: org,
  company_id: company,
  branch_id: null,
  owner_user_id: owner,
  first_name: "Priya",
  status: "new",
};
const unownedLead = { ...ownedLead, owner_user_id: null };

// A faithful-enough mock: it inspects the ACTUAL generated SQL/parameters
// rather than hardcoding pass/fail. When recordScope() has added the
// owner-scope predicate (detected by the literal "IS NULL OR" fragment the
// implementation emits), visibility is derived from the real bound
// parameter — the same computation Postgres would perform. This lets these
// tests catch a real regression in the SQL recordScope() builds, not just
// assert on which test name is running.
function crmClient({ leadRow = ownedLead, table = "crm_leads", ownerColumn = "owner_user_id" } = {}) {
  function visible(sql, params) {
    // Locate the exact $N placeholder recordScope() bound the owner-scope
    // value to, rather than assuming it is the last parameter — list
    // queries append further LIMIT/OFFSET parameters after it.
    const match = sql.match(new RegExp(`${ownerColumn} = \\$(\\d+)\\)`));
    if (!match) return true;
    const requestingUserId = params[Number(match[1]) - 1];
    return leadRow[ownerColumn] == null || leadRow[ownerColumn] === requestingUserId;
  }
  return {
    async query(sql, params = []) {
      if (sql.includes(`FROM tenant.${table} record WHERE`) && sql.includes("count(*)::int AS total")) {
        return { rows: [{ total: visible(sql, params) ? 1 : 0 }] };
      }
      if (sql.includes(`FROM tenant.${table} record WHERE`)) {
        return { rows: visible(sql, params) ? [leadRow] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("CRM: owner can read their own lead via list", async () => {
  const result = await listCrmRecords(crmClient(), ownerContext, "leads", {});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, leadId);
});

test("CRM: a different, unauthorized sales rep does not see the lead in list queries (list scoping)", async () => {
  const result = await listCrmRecords(crmClient(), otherRepContext, "leads", {});
  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 0);
});

test("CRM: an elevated manager (crm.records.view_all) sees every lead regardless of owner", async () => {
  const result = await listCrmRecords(crmClient(), managerContext, "leads", {});
  assert.equal(result.rows.length, 1);
});

test("CRM: owner can read their own lead by direct ID lookup", async () => {
  const record = await getCrmRecord(crmClient(), ownerContext, "leads", leadId);
  assert.equal(record.id, leadId);
});

test("CRM: unauthorized user cannot access another rep's lead by direct ID (IDOR)", async () => {
  await assert.rejects(
    getCrmRecord(crmClient(), otherRepContext, "leads", leadId),
    (error) => error.status === 404 && /CRM record not found/.test(error.message),
  );
});

test("CRM: a lead with no owner yet remains visible to any rep who can otherwise see the resource", async () => {
  const record = await getCrmRecord(crmClient({ leadRow: unownedLead }), otherRepContext, "leads", leadId);
  assert.equal(record.id, leadId);
});

test("CRM: unauthorized user cannot update another rep's lead (blocked before any write is attempted)", async () => {
  await assert.rejects(
    updateCrmRecord(crmClient(), otherRepContext, "leads", leadId, { status: "qualified" }),
    (error) => error.status === 404 && /CRM record not found/.test(error.message),
  );
});

test("CRM: owner's update on their own lead is not blocked by the scope gate", async () => {
  // getCrmRecord (the scope gate) succeeds for the owner; the subsequent UPDATE query is
  // unmocked, so reaching it (rather than a 404) proves the gate did not fire.
  await assert.rejects(
    updateCrmRecord(crmClient(), ownerContext, "leads", leadId, { status: "qualified" }),
    (error) => !(error.status === 404 && /CRM record not found/.test(error.message)),
  );
});

test("CRM: unauthorized user cannot archive another rep's lead", async () => {
  await assert.rejects(
    archiveCrmRecord(crmClient(), otherRepContext, "leads", leadId),
    (error) => error.status === 404 && /CRM record not found/.test(error.message),
  );
});

test("CRM: a non-elevated rep cannot reassign lead ownership to a different user (self-service escalation closed)", async () => {
  await assert.rejects(
    createCrmRecord(crmClient(), ownerContext, "leads", {
      firstName: "New",
      lastName: "Lead",
      ownerUserId: otherUser,
    }),
    (error) => error.status === 403 && /assign this record to another user/.test(error.message),
  );
});

test("CRM: a non-elevated rep CAN create a record and own it themselves", async () => {
  // Reaching the (unmocked) INSERT rather than the 403 assignment error proves self-ownership
  // on create is unaffected.
  await assert.rejects(
    createCrmRecord(crmClient(), ownerContext, "leads", {
      firstName: "New",
      lastName: "Lead",
      lastNameProvided: true,
      employmentType: undefined,
      ownerUserId: owner,
    }),
    (error) => !/assign this record to another user/.test(error.message),
  );
});

test("CRM: an elevated manager CAN reassign lead ownership to another user", async () => {
  await assert.rejects(
    createCrmRecord(crmClient(), managerContext, "leads", {
      firstName: "New",
      lastName: "Lead",
      ownerUserId: otherUser,
    }),
    (error) => !/assign this record to another user/.test(error.message),
  );
});

function dashboardClient(rows) {
  return {
    async query(sql) {
      if (/^SELECT\s+\(SELECT organization\.base_currency/.test(sql.trim())) {
        return { rows: [{ currency_code: "INR", open_leads: rows.openLeads }] };
      }
      if (/FROM tenant\.crm_pipeline_stages stage/.test(sql)) return { rows: [] };
      if (/FROM tenant\.crm_leads lead LEFT JOIN tenant\.crm_lead_sources/.test(sql)) return { rows: [] };
      if (/FROM tenant\.crm_activities activity LEFT JOIN public\.users/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected dashboard query: ${sql}`);
    },
  };
}

test("CRM analytics: a restricted rep's dashboard metrics only count their own records", async () => {
  // The mock ignores the actual predicate and just returns a canned distinguishing value per
  // context so the test asserts the query was issued with the scoping parameters wired in —
  // the real guarantee (which parameters land in the SQL) is covered by the source-level
  // review in ERP_SECURITY_HARDENING_003.md; this test exercises the call succeeds and
  // threads context.userId/canViewAllCrmRecords through to the query parameters.
  let capturedParams;
  const client = {
    async query(sql, params) {
      capturedParams = params;
      if (/^SELECT\s+\(SELECT organization\.base_currency/.test(sql.trim())) return { rows: [{}] };
      return { rows: [] };
    },
  };
  await getCrmDashboard(client, otherRepContext);
  assert.equal(capturedParams[4], false); // canViewAllCrmRecords(otherRepContext) === false
  assert.equal(capturedParams[5], otherUser);

  let managerParams;
  const managerClient = {
    async query(sql, params) {
      managerParams = params;
      if (/^SELECT\s+\(SELECT organization\.base_currency/.test(sql.trim())) return { rows: [{}] };
      return { rows: [] };
    },
  };
  await getCrmDashboard(managerClient, managerContext);
  assert.equal(managerParams[4], true); // canViewAllCrmRecords(managerContext) === true
});

test("CRM analytics: the forecast (salesperson performance) report threads owner-scope parameters", async () => {
  let capturedParams;
  const client = {
    async query(sql, params) {
      capturedParams = params;
      return { rows: [] };
    },
  };
  await getCrmReport(client, otherRepContext, "forecast", {});
  assert.equal(capturedParams[6], false); // $7 canViewAllCrmRecords
  assert.equal(capturedParams[7], otherUser); // $8 context.userId

  let managerParams;
  const managerClient = {
    async query(sql, params) {
      managerParams = params;
      return { rows: [] };
    },
  };
  await getCrmReport(managerClient, managerContext, "forecast", {});
  assert.equal(managerParams[6], true);
});

test("CRM: activities are scoped by their own assignee, independent of a parent opportunity's owner (parent/child bypass closed)", async () => {
  const activityId = "66666666-6666-4666-8666-666666666666";
  const opportunityIdTheCallerCannotSee = "77777777-7777-4777-8777-777777777777";
  const activityOwnedByOther = {
    id: activityId,
    organization_id: org,
    company_id: company,
    branch_id: null,
    assigned_to: owner, // assigned to a colleague, not otherRepContext's user
    entity_type: "opportunity",
    entity_id: opportunityIdTheCallerCannotSee,
    subject: "Follow up call",
    status: "open",
  };
  const client = crmClient({ leadRow: activityOwnedByOther, table: "crm_activities", ownerColumn: "assigned_to" });
  await assert.rejects(
    getCrmRecord(client, otherRepContext, "activities", activityId),
    (error) => error.status === 404,
  );
});

// Prompt 14: apps/web's crmContext() previously never propagated
// session.permissions/session.roleSlugs, so canViewAllCrmRecords()
// evaluated false for every real request — including organization_owner,
// whose elevated visibility is granted via roleSlugs, not an explicit
// permission entry. These pure-function tests were already possible before
// Prompt 14 (canViewAllCrmRecords() itself was always correct); what was
// missing is a real end-to-end proof that a real session actually reaches
// it with these fields populated — see
// services/worker/tests/crm-auth-context-live.manual.mjs for that.
test("CRM: organization_owner sees every lead via roleSlugs alone, with an EMPTY permissions array (Prompt 13/14's specific finding)", async () => {
  const orgOwnerContext = baseContext(otherUser, []);
  orgOwnerContext.roleSlugs = ["organization_owner"];
  orgOwnerContext.allowAllCompanies = true;
  const result = await listCrmRecords(crmClient(), orgOwnerContext, "leads", {});
  assert.equal(result.rows.length, 1);
});

// Regression guard for a real reported bug: a lead created while the
// company switcher was set to Company A was visible while switched to
// Company B, for organization_owner/system_administrator accounts (and
// any other allowAllCompanies role). Root cause: recordScope() treated
// allowAllCompanies as "skip company filtering unconditionally" instead
// of "only skip it when no company is actively selected at all." This
// mock, unlike crmClient() above, also inspects the company-scope
// predicate's bound parameter, not just the owner-scope one — the fix
// specifically changed that predicate's shape.
const otherCompany = "66666666-6666-4666-8666-666666666666";
function companyAwareCrmClient({ leadRow = ownedLead } = {}) {
  function visible(sql, params) {
    const companyMatch = sql.match(/company_id = \$(\d+)\)/);
    if (companyMatch) {
      const boundCompanyId = params[Number(companyMatch[1]) - 1];
      if (leadRow.company_id != null && leadRow.company_id !== boundCompanyId) return false;
    }
    return true;
  }
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM tenant.crm_leads record WHERE") && sql.includes("count(*)::int AS total")) {
        return { rows: [{ total: visible(sql, params) ? 1 : 0 }] };
      }
      if (sql.includes("FROM tenant.crm_leads record WHERE")) {
        return { rows: visible(sql, params) ? [leadRow] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("CRM: an elevated (allowAllCompanies) user switched to Company A does NOT see a lead that belongs to Company B", async () => {
  const leadInOtherCompany = { ...ownedLead, company_id: otherCompany };
  const ctx = { ...managerContext, activeCompanyId: company, allowAllCompanies: true };
  const result = await listCrmRecords(companyAwareCrmClient({ leadRow: leadInOtherCompany }), ctx, "leads", {});
  assert.equal(result.rows.length, 0, "the active company selector must scope allowAllCompanies roles too, not just restricted ones");
});

test("CRM: an elevated (allowAllCompanies) user switched to Company A DOES see a lead that belongs to Company A", async () => {
  const leadInActiveCompany = { ...ownedLead, company_id: company };
  const ctx = { ...managerContext, activeCompanyId: company, allowAllCompanies: true };
  const result = await listCrmRecords(companyAwareCrmClient({ leadRow: leadInActiveCompany }), ctx, "leads", {});
  assert.equal(result.rows.length, 1);
});

test("CRM: an elevated (allowAllCompanies) user with NO company selected still sees a lead from any company (fallback preserved)", async () => {
  const leadInOtherCompany = { ...ownedLead, company_id: otherCompany };
  const ctx = { ...managerContext, activeCompanyId: null, allowAllCompanies: true };
  const result = await listCrmRecords(companyAwareCrmClient({ leadRow: leadInOtherCompany }), ctx, "leads", {});
  assert.equal(result.rows.length, 1, "allowAllCompanies must still mean something when no specific company is selected");
});

test("CRM: a context missing permissions/roleSlugs entirely fails CLOSED — canViewAllCrmRecords() must never default to open", async () => {
  const bareContext = {
    organizationId: org,
    userId: otherUser,
    activeCompanyId: company,
    activeBranchId: null,
    allowAllCompanies: true,
    // permissions/roleSlugs intentionally omitted
  };
  const result = await listCrmRecords(crmClient(), bareContext, "leads", {});
  assert.equal(result.rows.length, 0, "must be restricted, not view-all, when permission data is absent");
});

test("CRM: recordScope() does not leave a stray bound parameter when the branch-scope gate fails closed (regression guard for the live-DB-discovered bind-mismatch bug)", async () => {
  // Before the Prompt 14 fix, the branch-scope gate's early `return " AND
  // false"` discarded the already-built company-scope SQL fragment while
  // the parameter it bound stayed in the `parameters` array — a real
  // Postgres "bind message supplies N parameters, but prepared statement
  // requires N-1" crash for any restricted (non-allowAllCompanies) user
  // with activeCompanyId set but activeBranchId null (any branch-less
  // company). This only surfaces against a real driver, which is why this
  // mock asserts $-placeholder count in the SQL text matches params.length
  // exactly, instead of only checking the returned rows.
  const restrictedNoBranch = baseContext(otherUser, repPermissions);
  restrictedNoBranch.activeBranchId = null;
  const client = {
    async query(sql, params = []) {
      const placeholderCount = new Set(sql.match(/\$\d+/g) || []).size;
      assert.equal(placeholderCount, params.length, `SQL references ${placeholderCount} distinct placeholders but ${params.length} parameters were bound: ${sql}`);
      return sql.includes("count(*)::int AS total") ? { rows: [{ total: 0 }] } : { rows: [] };
    },
  };
  const result = await listCrmRecords(client, restrictedNoBranch, "leads", {});
  assert.equal(result.rows.length, 0);
});

test("CRM: an elevated manager (crm.records.view_all) sees every OPPORTUNITY regardless of owner, mirroring lead scoping", async () => {
  const opportunityId = "88888888-8888-4888-8888-888888888888";
  const opportunityOwnedByOther = {
    id: opportunityId,
    organization_id: org,
    company_id: company,
    branch_id: null,
    owner_user_id: owner,
    name: "Renewal",
    status: "open",
  };
  const client = crmClient({ leadRow: opportunityOwnedByOther, table: "crm_opportunities", ownerColumn: "owner_user_id" });
  const restricted = await listCrmRecords(client, otherRepContext, "opportunities", {});
  assert.equal(restricted.rows.length, 0);
  const elevated = await listCrmRecords(client, managerContext, "opportunities", {});
  assert.equal(elevated.rows.length, 1);
});

test("CRM: duplicate detection is NOT owner-scoped — a restricted rep still sees a colleague's matching lead (regression guard)", async () => {
  // findCrmDuplicates exists specifically to catch the case where a
  // DIFFERENT rep already owns a matching lead. Naively reusing
  // recordScope(resources.leads, ...) here would silently narrow it to
  // "duplicates I own," defeating its purpose — this was caught during the
  // Part 12 adversarial review and fixed by stripping ownerField for this
  // one query only (see services/api/src/modules/crm/index.js, findCrmDuplicates).
  const colleaguesLead = {
    id: leadId,
    code: "LEAD-1",
    full_name: "Priya Match",
    email: "priya@example.com",
    mobile: null,
    company_name: "Acme",
    status: "new",
    match_score: 2,
  };
  const client = {
    async query(sql) {
      assert.doesNotMatch(sql, /owner_user_id/, "duplicate detection must not filter by owner_user_id");
      return { rows: [colleaguesLead] };
    },
  };
  const duplicates = await findCrmDuplicates(client, otherRepContext, { email: "priya@example.com" });
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].id, leadId);
});
