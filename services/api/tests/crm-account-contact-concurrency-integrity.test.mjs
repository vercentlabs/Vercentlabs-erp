import assert from "node:assert/strict";
import test from "node:test";

import { updateCrmAccount, archiveCrmAccount } from "../src/modules/crm/prospect-and-relationship-master-data/account-operations.js";
import { updateCrmContact, archiveCrmContact, reactivateCrmContact } from "../src/modules/crm/prospect-and-relationship-master-data/contact-operations.js";

// Integrity closeout (Prompts 1-5): ordinary Account/Contact edits
// (updateCrmAccount/archiveCrmAccount/updateCrmContact/archiveCrmContact/
// reactivateCrmContact) previously ran a plain `UPDATE ... WHERE id=$2`
// with no expected-version check at all — two concurrent editors could
// silently overwrite each other, unlike Opportunity stage/probability
// commands and Lead updates, which already had this protection. Each now
// requires (when a version is supplied) that the row's updated_at still
// matches what the caller read, mirroring Lead's CRM_STALE_WRITE contract
// exactly.

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";
const accountId = "55555555-5555-4555-8555-555555555555";
const contactId = "66666666-6666-4666-8666-666666666666";

const context = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.parties.manage"],
};

const freshTimestamp = "2026-09-09T00:00:00.000Z";
const staleTimestamp = "2020-01-01T00:00:00.000Z";

function accountRow(overrides = {}) {
  return {
    id: accountId,
    organization_id: org,
    company_id: myCompany,
    party_type: "prospect",
    display_name: "Acme",
    status: "active",
    updated_at: freshTimestamp,
    ...overrides,
  };
}

function contactRow(overrides = {}) {
  return {
    id: contactId,
    organization_id: org,
    party_id: accountId,
    first_name: "Priya",
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
      if (/^\s*SELECT/i.test(sql) || sql.includes("relationship_counts") || sql.includes("SELECT\n       ")) {
        return { rows: selectRow ? [selectRow] : [] };
      }
      if (/^\s*UPDATE/i.test(sql)) {
        return { rows: updateRowCount > 0 ? [{ id: accountId }] : [], rowCount: updateRowCount };
      }
      return { rows: [] };
    },
  };
}

test("updateCrmAccount: a correctly-supplied expectedUpdatedAt is accepted (no stale-write error)", async () => {
  const client = mockClient({ selectRow: accountRow() });
  // The full function does more than one SELECT (relationship counts, party
  // select) via getCrmAccount/getCrmAccountForCaller — the mock returns the
  // same row shape for any SELECT, which is sufficient to prove the version
  // check itself passes without throwing CRM_STALE_WRITE.
  await assert.doesNotReject(
    updateCrmAccount(client, context, accountId, { displayName: "Acme Corp" }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
  );
});

test("updateCrmAccount: a stale expectedUpdatedAt is rejected with CRM_STALE_WRITE (409)", async () => {
  const client = mockClient({ selectRow: accountRow() });
  await assert.rejects(
    updateCrmAccount(client, context, accountId, { displayName: "Acme Corp" }, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("updateCrmAccount: requireVersion:true with no expectedUpdatedAt supplied is rejected (400, version required)", async () => {
  const client = mockClient({ selectRow: accountRow() });
  await assert.rejects(
    updateCrmAccount(client, context, accountId, { displayName: "Acme Corp" }, {
      requireVersion: true,
    }),
    (error) => error.status === 400 && error.code === "CRM_ACCOUNT_VERSION_REQUIRED",
  );
});

test("updateCrmAccount: the UPDATE statement itself carries a checked-write WHERE clause on updated_at when a version is supplied", async () => {
  const client = mockClient({ selectRow: accountRow() });
  await updateCrmAccount(client, context, accountId, { displayName: "Acme Corp" }, {
    expectedUpdatedAt: freshTimestamp,
    requireVersion: true,
  });
  const updateQuery = client.queries.find((q) => q.sql.includes("UPDATE tenant.business_parties account"));
  assert.ok(updateQuery, "expected the account UPDATE query");
  assert.match(updateQuery.sql, /AND account\.updated_at = \$\d+/, "must guard the write with the expected version");
  assert.ok(updateQuery.values.includes(freshTimestamp), "the expected timestamp must be bound as a parameter");
});

test("updateCrmAccount: a race between the version check and the write itself (zero rows updated) still raises CRM_STALE_WRITE", async () => {
  const client = mockClient({ selectRow: accountRow(), updateRowCount: 0 });
  await assert.rejects(
    updateCrmAccount(client, context, accountId, { displayName: "Acme Corp" }, {
      expectedUpdatedAt: freshTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("archiveCrmAccount: a stale expectedUpdatedAt is rejected", async () => {
  const client = mockClient({ selectRow: accountRow() });
  await assert.rejects(
    archiveCrmAccount(client, context, accountId, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("updateCrmContact: a stale expectedUpdatedAt is rejected", async () => {
  const client = mockClient({ selectRow: contactRow() });
  await assert.rejects(
    updateCrmContact(client, context, contactId, { firstName: "Priyanka" }, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("archiveCrmContact: a stale expectedUpdatedAt is rejected", async () => {
  const client = mockClient({ selectRow: contactRow() });
  await assert.rejects(
    archiveCrmContact(client, context, contactId, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});

test("reactivateCrmContact: a stale expectedUpdatedAt is rejected", async () => {
  const client = mockClient({ selectRow: contactRow({ status: "inactive" }) });
  await assert.rejects(
    reactivateCrmContact(client, context, contactId, {
      expectedUpdatedAt: staleTimestamp,
      requireVersion: true,
    }),
    (error) => error.status === 409 && error.code === "CRM_STALE_WRITE",
  );
});
