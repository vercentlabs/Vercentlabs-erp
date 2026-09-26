// Field write protection (docs: packages/permissions/src/field-security.js):
// the project budget and contracted revenue are hidden from callers without a
// project finance permission, so those callers may not submit them either.
// The refusal happens before any database work.
import assert from "node:assert/strict";
import test from "node:test";

import { createProjectRecord, updateProjectRecord } from "../src/modules/projects/setup.js";

const client = { query: async () => { throw new Error("DB_MUST_NOT_BE_REACHED"); } };
const context = (permissions) => ({ organizationId: "00000000-0000-4000-8000-000000000001", companyId: "00000000-0000-4000-8000-000000000002", userId: "00000000-0000-4000-8000-000000000003", roleSlugs: [], permissions });
const fieldDenied = (error) => error?.status === 403 && error?.code === "FIELD_ACCESS_DENIED";

test("a caller without project finance authority cannot submit budget or contracted revenue", async () => {
  await assert.rejects(() => createProjectRecord(client, context(["projects.view", "projects.create"]), { name: "P", contractedRevenue: 1000 }), fieldDenied);
  await assert.rejects(() => updateProjectRecord(client, context(["projects.view", "projects.manage"]), "00000000-0000-4000-8000-000000000009", { approvedBudget: 50 }), fieldDenied);
});

test("finance authority passes the field guard (the request then proceeds to the database)", async () => {
  await assert.rejects(() => createProjectRecord(client, context(["projects.view", "projects.create", "projects.budget.manage"]), { name: "P", contractedRevenue: 1000 }), /DB_MUST_NOT_BE_REACHED/);
  await assert.rejects(() => createProjectRecord(client, context(["projects.view", "projects.create"]), { name: "P" }), /DB_MUST_NOT_BE_REACHED/);
});
