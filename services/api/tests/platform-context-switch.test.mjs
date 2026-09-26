import assert from "node:assert/strict";
import test from "node:test";

import { switchActiveCompany, ContextSwitchError } from "../src/core/auth/session.js";

function baseSession() {
  return { organizationId: "org-1", userId: "user-1" };
}

test("switchActiveCompany rejects a company the user has no access to (never trusts the browser-supplied id)", async () => {
  const client = {
    query: async (sql) => {
      if (/FROM companies/.test(sql)) return { rows: [] }; // no accessible companies
      if (/FROM branches/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    switchActiveCompany(client, baseSession(), "company-not-mine", null),
    (error) => error instanceof ContextSwitchError && error.code === "COMPANY_ACCESS_DENIED",
  );
});

test("switchActiveCompany rejects a branch that doesn't belong to an otherwise-accessible company", async () => {
  const client = {
    query: async (sql) => {
      if (/FROM companies/.test(sql)) return { rows: [{ id: "company-1", name: "Acme" }] };
      if (/FROM branches/.test(sql)) return { rows: [] }; // no accessible branches for company-1
      return { rows: [] };
    },
  };
  await assert.rejects(
    switchActiveCompany(client, baseSession(), "company-1", "branch-not-mine"),
    (error) => error instanceof ContextSwitchError && error.code === "BRANCH_ACCESS_DENIED",
  );
});

test("switchActiveCompany persists an accessible company+branch via upsert", async () => {
  let upsertValues;
  const client = {
    query: async (sql, values) => {
      if (/FROM companies/.test(sql)) return { rows: [{ id: "company-1", name: "Acme" }] };
      if (/FROM branches/.test(sql)) return { rows: [{ id: "branch-1", company_id: "company-1", name: "HQ" }] };
      if (/INSERT INTO user_preferences/.test(sql)) { upsertValues = values; return { rows: [] }; }
      return { rows: [] };
    },
  };
  const result = await switchActiveCompany(client, baseSession(), "company-1", "branch-1");
  assert.deepEqual(result, { companyId: "company-1", branchId: "branch-1" });
  assert.deepEqual(upsertValues, ["org-1", "user-1", "company-1", "branch-1"]);
});

test("switchActiveCompany allows a company switch with no branch selection", async () => {
  const client = {
    query: async (sql) => {
      if (/FROM companies/.test(sql)) return { rows: [{ id: "company-1", name: "Acme" }] };
      if (/FROM branches/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await switchActiveCompany(client, baseSession(), "company-1", null);
  assert.deepEqual(result, { companyId: "company-1", branchId: null });
});
