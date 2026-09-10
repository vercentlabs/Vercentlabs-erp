import assert from "node:assert/strict";
import test from "node:test";

import { updateCrmRecord, archiveCrmRecord } from "../src/modules/crm/index.js";

// Integrity closeout (Prompts 1-5): ordinary Opportunity edits through the
// generic updateCrmRecord/archiveCrmRecord path (amount/description/close
// date/etc. — everything except the dedicated stage/probability commands,
// which already had this protection) never accepted or enforced an
// expected-version at all. Two concurrent editors of the same Opportunity's
// ordinary fields could silently overwrite each other. This mirrors Lead's
// exact CRM_STALE_WRITE contract, now generalized via
// assertRecordExpectedVersion.

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";
const opportunityId = "55555555-5555-4555-8555-555555555555";

const myBranch = "99999999-9999-4999-8999-999999999999";

const context = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: myBranch,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

const freshTimestamp = "2026-09-09T00:00:00.000Z";
const staleTimestamp = "2020-01-01T00:00:00.000Z";

function opportunityRow(overrides = {}) {
  return {
    id: opportunityId,
    organization_id: org,
    company_id: myCompany,
    branch_id: myBranch,
    owner_user_id: actorId,
    pipeline_id: "66666666-6666-4666-8666-666666666666",
    stage_id: "77777777-7777-4777-8777-777777777777",
    name: "Deal",
    amount: "10000.00",
    currency_code: "INR",
    probability: "10.00",
    status: "open",
    forecast_category: "pipeline",
    updated_at: freshTimestamp,
  };
}

function mockClient({ selectRow, updateRowCount = 1 }) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/^\s*UPDATE/i.test(sql)) {
        return { rows: updateRowCount > 0 ? [selectRow] : [], rowCount: updateRowCount };
      }
      // Every SELECT-shaped query (getCrmRecord, any incidental lookups)
      // returns the same fixed Opportunity row.
      return { rows: [selectRow] };
    },
  };
}

test("updateCrmRecord (opportunities): a correctly-supplied expectedUpdatedAt is accepted", async () => {
  const client = mockClient({ selectRow: opportunityRow() });
  await assert.doesNotReject(
    updateCrmRecord(client, context, "opportunities", opportunityId, { description: "Updated notes" }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
  );
});

test("updateCrmRecord (opportunities): a stale expectedUpdatedAt is rejected with CRM_STALE_WRITE (409)", async () => {
  const client = mockClient({ selectRow: opportunityRow() });
  await assert.rejects(
    updateCrmRecord(client, context, "opportunities", opportunityId, { description: "Updated notes" }, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("updateCrmRecord (opportunities): requireVersion:true with no expectedUpdatedAt supplied is rejected (400)", async () => {
  const client = mockClient({ selectRow: opportunityRow() });
  await assert.rejects(
    updateCrmRecord(client, context, "opportunities", opportunityId, { description: "Updated notes" }, {
      requireVersion: true,
    }),
    (error) => error.status === 400 && error.code === "CRM_OPPORTUNITY_VERSION_REQUIRED",
  );
});

test("updateCrmRecord (opportunities): the UPDATE statement carries a checked-write WHERE clause on updated_at", async () => {
  const client = mockClient({ selectRow: opportunityRow() });
  await updateCrmRecord(client, context, "opportunities", opportunityId, { description: "Updated notes" }, {
    expectedUpdatedAt: freshTimestamp,
    requireVersion: true,
  });
  const updateQuery = client.queries.find((q) => /^\s*UPDATE/i.test(q.sql));
  assert.ok(updateQuery, "expected an UPDATE query");
  assert.match(updateQuery.sql, /AND record\.updated_at = \$\d+/, "must guard the write with the expected version");
  assert.ok(updateQuery.values.includes(freshTimestamp), "the expected timestamp must be bound as a parameter");
});

test("updateCrmRecord (opportunities): a race between the version check and the write itself still raises CRM_STALE_WRITE, not a generic 404", async () => {
  const client = mockClient({ selectRow: opportunityRow(), updateRowCount: 0 });
  await assert.rejects(
    updateCrmRecord(client, context, "opportunities", opportunityId, { description: "Updated notes" }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("updateCrmRecord: an unversioned resource (e.g. tags) is completely unaffected — no expectations required, no version guard applied", async () => {
  const client = mockClient({ selectRow: { id: "88888888-8888-4888-8888-888888888888", organization_id: org, name: "vip", status: "active", updated_at: freshTimestamp } });
  await assert.doesNotReject(
    updateCrmRecord(client, context, "tags", "88888888-8888-4888-8888-888888888888", { name: "vip-2" }),
  );
  const updateQuery = client.queries.find((q) => /^\s*UPDATE/i.test(q.sql));
  assert.doesNotMatch(updateQuery.sql, /updated_at = \$\d+ RETURNING/, "unversioned resources must not gain a version-guard clause");
});

test("archiveCrmRecord (opportunities): a stale expectedUpdatedAt is rejected", async () => {
  const client = mockClient({ selectRow: opportunityRow() });
  await assert.rejects(
    archiveCrmRecord(client, context, "opportunities", opportunityId, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});
