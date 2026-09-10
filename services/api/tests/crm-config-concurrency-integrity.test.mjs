import assert from "node:assert/strict";
import test from "node:test";

import { updateCrmRecord, archiveCrmRecord } from "../src/modules/crm/index.js";

// Prompts 1-5 integrity closeout (blocker C): Qualification criteria (F006)
// and Won/Lost reasons (F026) are plain mutable generic-CRUD resources with
// no existing append-only/versioned model — they previously went through
// updateCrmRecord/archiveCrmRecord with zero stale-write protection, unlike
// Leads/Opportunities. Both now share the exact same checked-write contract.

const org = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const criterionId = "33333333-3333-4333-8333-333333333333";
const reasonId = "44444444-4444-4444-8444-444444444444";

const manager = {
  organizationId: org,
  userId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.view", "crm.settings.manage"],
};

const freshTimestamp = "2026-09-09T00:00:00.000Z";
const staleTimestamp = "2020-01-01T00:00:00.000Z";

function criterionRow(overrides = {}) {
  return {
    id: criterionId,
    organization_id: org,
    criterion_key: "website",
    label: "Website",
    tier: "recommended",
    check_type: "non_empty_any",
    field_keys: ["website"],
    sequence: 100,
    status: "active",
    updated_at: freshTimestamp,
    ...overrides,
  };
}

function reasonRow(overrides = {}) {
  return {
    id: reasonId,
    organization_id: org,
    name: "Lost to competitor",
    code: "lost_to_competitor",
    category: "competition",
    outcome_type: "lost",
    sequence: 100,
    status: "active",
    updated_at: freshTimestamp,
    ...overrides,
  };
}

function mockClient({ selectRow, updateRowCount = 1 } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/^\s*SELECT/i.test(sql)) return { rows: selectRow ? [selectRow] : [] };
      if (/^\s*UPDATE/i.test(sql))
        return { rows: updateRowCount > 0 ? [{ ...selectRow }] : [] };
      return { rows: [] };
    },
  };
}

test("updateCrmRecord(qualification-criteria): a correctly-supplied expectedUpdatedAt is accepted", async () => {
  const client = mockClient({ selectRow: criterionRow() });
  await assert.doesNotReject(
    updateCrmRecord(client, manager, "qualification-criteria", criterionId, { label: "Website (updated)" }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
  );
});

test("updateCrmRecord(qualification-criteria): a stale expectedUpdatedAt is rejected with 409 CRM_STALE_WRITE and issues no UPDATE", async () => {
  const client = mockClient({ selectRow: criterionRow({ updated_at: freshTimestamp }) });
  await assert.rejects(
    updateCrmRecord(client, manager, "qualification-criteria", criterionId, { label: "Website (stale edit)" }, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "CRM_STALE_WRITE");
      return true;
    },
  );
  assert.equal(client.queries.filter((q) => /^\s*UPDATE/i.test(q.sql)).length, 0);
});

test("updateCrmRecord(qualification-criteria): requireVersion without a supplied version is rejected (400)", async () => {
  const client = mockClient({ selectRow: criterionRow() });
  await assert.rejects(
    updateCrmRecord(client, manager, "qualification-criteria", criterionId, { label: "Website (updated)" }, {
      requireVersion: true,
    }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "CRM_QUALIFICATION_CRITERIA_VERSION_REQUIRED");
      return true;
    },
  );
});

test("updateCrmRecord(lost-reasons): a correctly-supplied expectedUpdatedAt is accepted", async () => {
  const client = mockClient({ selectRow: reasonRow() });
  await assert.doesNotReject(
    updateCrmRecord(client, manager, "lost-reasons", reasonId, { sequence: 50 }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
  );
});

test("updateCrmRecord(lost-reasons): reordering two reasons — a stale sequence swap on one of the pair is rejected without touching the other", async () => {
  // Mirrors the workspace's real reorder pattern: two independent PATCH
  // calls, each carrying its own row's expectedUpdatedAt. One row is
  // fresh (accepted); the other has gone stale (a concurrent admin's edit
  // landed first) and must be rejected without silently applying its swap.
  const freshClient = mockClient({ selectRow: reasonRow({ id: reasonId, updated_at: freshTimestamp }) });
  await assert.doesNotReject(
    updateCrmRecord(freshClient, manager, "lost-reasons", reasonId, { sequence: 200 }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
  );
  const staleOtherId = "55555555-5555-4555-8555-555555555555";
  const staleClient = mockClient({ selectRow: reasonRow({ id: staleOtherId, updated_at: freshTimestamp }) });
  await assert.rejects(
    updateCrmRecord(staleClient, manager, "lost-reasons", staleOtherId, { sequence: 100 }, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("archiveCrmRecord(lost-reasons): deactivating with a stale expectedUpdatedAt is rejected with 409 CRM_STALE_WRITE", async () => {
  const client = mockClient({ selectRow: reasonRow({ status: "active", updated_at: freshTimestamp }), updateRowCount: 0 });
  await assert.rejects(
    archiveCrmRecord(client, manager, "lost-reasons", reasonId, {
      expectedUpdatedAt: freshTimestamp,
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "CRM_STALE_WRITE");
      return true;
    },
  );
});

test("archiveCrmRecord(lost-reasons): deactivating with a correctly-supplied expectedUpdatedAt succeeds", async () => {
  const client = mockClient({ selectRow: reasonRow({ status: "active", updated_at: freshTimestamp }), updateRowCount: 1 });
  const updated = await archiveCrmRecord(client, manager, "lost-reasons", reasonId, {
    expectedUpdatedAt: freshTimestamp,
  });
  assert.equal(updated.id, reasonId);
});

test("archiveCrmRecord(lost-reasons): no expectedUpdatedAt supplied still archives (version is optional here, matching Opportunity's own contract — required only where a caller opts in)", async () => {
  const client = mockClient({ selectRow: reasonRow({ status: "active", updated_at: freshTimestamp }), updateRowCount: 1 });
  await assert.doesNotReject(archiveCrmRecord(client, manager, "lost-reasons", reasonId, {}));
});
