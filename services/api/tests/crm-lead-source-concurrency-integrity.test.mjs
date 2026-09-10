import assert from "node:assert/strict";
import test from "node:test";

import { updateCrmLeadSource, setCrmLeadSourceActive } from "../src/modules/crm/lead-source-operations.js";

// Prompts 1-5 integrity closeout (blocker C): mutable Lead Source
// operations (edit, activate/deactivate) previously ran a plain
// `UPDATE ... WHERE id=$2` with no expected-version check at all — a stale
// administrator could silently overwrite a newer edit. Both now reuse the
// shared assertExpectedRecordVersion/checked-write contract, matching
// Account/Contact/Opportunity exactly.

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const sourceId = "77777777-7777-4777-8777-777777777777";

const context = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.view", "crm.settings.manage"],
};

const freshTimestamp = "2026-09-09T00:00:00.000Z";
const staleTimestamp = "2020-01-01T00:00:00.000Z";

function sourceRow(overrides = {}) {
  return {
    id: sourceId,
    organization_id: org,
    name: "Website",
    code: "WEBSITE",
    description: null,
    channel: "website",
    sort_order: 100,
    is_default: false,
    status: "active",
    is_system: false,
    archived_at: null,
    updated_at: freshTimestamp,
    lead_count: 0,
    ...overrides,
  };
}

function mockClient({ selectRow, updateRowCount = 1 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: selectRow ? [selectRow] : [] };
      }
      if (/^\s*UPDATE/i.test(sql)) {
        return { rows: updateRowCount > 0 ? [{ id: sourceId }] : [], rowCount: updateRowCount };
      }
      return { rows: [] };
    },
  };
}

test("updateCrmLeadSource: a correctly-supplied expectedUpdatedAt is accepted (no stale-write error)", async () => {
  const client = mockClient({ selectRow: sourceRow() });
  await assert.doesNotReject(
    updateCrmLeadSource(client, context, sourceId, { name: "Website (updated)" }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
  );
});

test("updateCrmLeadSource: Admin A loads source, Admin B changes it, Admin A saves a stale copy -> 409 CRM_STALE_WRITE, B's update preserved", async () => {
  // Admin A's expectedUpdatedAt reflects the row as A originally loaded it;
  // the mock's SELECT returns the row as it now stands after Admin B's
  // concurrent write (a later updated_at) — exactly the real race.
  const client = mockClient({ selectRow: sourceRow({ updated_at: freshTimestamp, name: "Website (B's edit)" }) });
  await assert.rejects(
    updateCrmLeadSource(client, context, sourceId, { name: "Website (A's stale edit)" }, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "CRM_STALE_WRITE");
      return true;
    },
  );
  // No UPDATE statement should have been issued after the version check
  // rejected the write — B's edit remains untouched.
  const updateQueries = client.queries.filter((q) => /^\s*UPDATE/i.test(q.sql));
  assert.equal(updateQueries.length, 0, "a stale write must not issue any UPDATE");
});

test("updateCrmLeadSource: requireVersion:true without a supplied expectedUpdatedAt is rejected (400 CRM_LEAD_SOURCE_VERSION_REQUIRED)", async () => {
  const client = mockClient({ selectRow: sourceRow() });
  await assert.rejects(
    updateCrmLeadSource(client, context, sourceId, { name: "Website (updated)" }, {
      requireVersion: true,
    }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "CRM_LEAD_SOURCE_VERSION_REQUIRED");
      return true;
    },
  );
});

test("setCrmLeadSourceActive: a real DB-level race (zero rows affected by the checked UPDATE despite a matching pre-read) still surfaces CRM_STALE_WRITE", async () => {
  // Simulates the narrow window between the version-check SELECT and the
  // checked UPDATE itself: the SELECT still shows the timestamp the caller
  // expects, but a concurrent writer commits first, so the UPDATE's own
  // `AND updated_at=$N` guard affects zero rows.
  const client = mockClient({ selectRow: sourceRow({ status: "active" }), updateRowCount: 0 });
  await assert.rejects(
    setCrmLeadSourceActive(client, context, sourceId, false, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "CRM_STALE_WRITE");
      return true;
    },
  );
});

test("setCrmLeadSourceActive: reactivation with a correctly-supplied expectedUpdatedAt succeeds", async () => {
  const client = mockClient({ selectRow: sourceRow({ status: "inactive" }) });
  const updated = await setCrmLeadSourceActive(client, context, sourceId, true, {
    expectedUpdatedAt: freshTimestamp,
    requireVersion: true,
  });
  assert.equal(updated.id, sourceId);
});
