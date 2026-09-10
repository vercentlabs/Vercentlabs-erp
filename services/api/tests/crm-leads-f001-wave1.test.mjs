import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { getLeadOperationsDashboard } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-operations.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: "33333333-3333-4333-8333-333333333333",
  activeBranchId: "44444444-4444-4444-8444-444444444444",
  allowAllCompanies: false,
  roleSlugs: [],
  permissions: [],
};

test("F001 Wave 1: operations dashboard composes company, branch and owner record scope", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("crm_scoring_rules")) return { rows: [{ configured: false }] };
      return { rows: [], rowCount: 0 };
    },
  };

  await getLeadOperationsDashboard(client, context);
  const query = calls.find((call) => call.sql.includes("FROM tenant.crm_leads lead"));
  assert.ok(query, "Lead dashboard query should execute");
  assert.match(query.sql, /lead\.company_id IS NULL OR lead\.company_id=\$2/);
  assert.match(query.sql, /lead\.branch_id IS NULL OR lead\.branch_id=\$3/);
  assert.match(query.sql, /lead\.owner_user_id IS NULL OR lead\.owner_user_id=\$4/);
  assert.deepEqual(query.values, [
    context.organizationId,
    context.activeCompanyId,
    context.activeBranchId,
    context.userId,
  ]);
});

test("F001 Wave 1: authoritative Lead mutations use row locks and stale-write conflicts", () => {
  const source = [
    read("src/modules/crm/crm-data-operations-and-customization/resource-validation.js"),
    read("src/modules/crm/crm-data-operations-and-customization/resource-mutation-service.js"),
    read("src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-assignment.js"),
  ].join("\n");
  assert.match(source, /async function getLeadRecordForUpdate[\s\S]*FOR UPDATE/);
  // Integrity closeout (Prompts 1-5): assertLeadExpectedVersion's literal
  // CRM_LEAD_VERSION_REQUIRED/CRM_LEAD_VERSION_INVALID codes were
  // generalized into assertRecordExpectedVersion (entityLabel/codePrefix
  // parameters), reused for Opportunity ordinary edits too — Lead's own
  // codes are now produced by passing codePrefix="CRM_LEAD" through the
  // thin assertLeadExpectedVersion wrapper rather than appearing as a
  // literal string, so match the generalized shape instead of the old
  // literal constants.
  assert.match(source, /function assertRecordExpectedVersion\(/);
  assert.match(source, /\$\{codePrefix\}_VERSION_REQUIRED/);
  assert.match(source, /\$\{codePrefix\}_VERSION_INVALID/);
  assert.match(source, /function assertLeadExpectedVersion[\s\S]*assertRecordExpectedVersion\(record, expectedUpdatedAt, required, "Lead", "CRM_LEAD"\)/);
  assert.match(source, /CRM_STALE_WRITE/);
  assert.match(source, /updateCrmRecord\([\s\S]*expectations = \{\}/);
  assert.match(source, /archiveCrmRecord\([\s\S]*expectations = \{\}/);
  assert.match(source, /assignLeadOwner[\s\S]*options\.expectedUpdatedAt/);
});

test("F001 Wave 1: Lead merge locks deterministically before replay check and uses record_status terminal state", () => {
  const source = read("src/modules/crm/crm-conversion-and-sales-handoff/lead-conversion.js");
  const start = source.indexOf("export async function mergeCrmLead");
  const merge = source.slice(start);
  const lock = merge.indexOf("ORDER BY record.id FOR UPDATE");
  const replay = merge.indexOf("SELECT * FROM tenant.crm_merge_records");
  assert.ok(lock >= 0 && replay > lock, "durable replay lookup must happen after row locks");
  assert.match(merge, /source\.record_status/);
  assert.match(merge, /target\.record_status/);
  assert.doesNotMatch(merge, /includes\(source\.status\)/);
  assert.doesNotMatch(merge, /includes\(target\.status\)/);
});

test("F001 Wave 1: lifecycle expected-version parsing is bounded and invalid timestamps are actionable", () => {
  // F007 Prompt 4: implementation moved to the lifecycle/ capability directory.
  const source = read("src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/transition-engine.js");
  assert.match(source, /input\.requireVersion === true/);
  assert.match(source, /CRM_LEAD_VERSION_REQUIRED/);
  assert.match(source, /Number\.isFinite\(expected\.getTime\(\)\)/);
  assert.match(source, /CRM_LEAD_VERSION_INVALID/);
  assert.match(source, /CRM_LEAD_STAGE_CONFLICT/);
});


test("F001 Wave 1: package root inherits canonical assignLeadOwner type without shadowing", () => {
  const rootTypes = read("src/index.d.ts");
  const crmTypes = read("src/modules/crm/index.d.ts");

  assert.match(
    rootTypes,
    /export \* from "\.\/modules\/crm\/index\.js";/,
  );
  assert.doesNotMatch(
    rootTypes,
    /export function assignLeadOwner\(/,
    "the package root must not shadow the canonical CRM declaration",
  );

  const start = crmTypes.indexOf("export function assignLeadOwner(");
  const end = crmTypes.indexOf("export function listLeadStages", start);
  const declaration = crmTypes.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(declaration, /context: CrmContext/);
  assert.match(declaration, /expectedUpdatedAt\?: string/);
  assert.match(declaration, /requireVersion\?: boolean/);
});
