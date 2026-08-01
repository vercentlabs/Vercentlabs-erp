import assert from "node:assert/strict";
import test from "node:test";
import {
  findAccountDuplicates,
  findContactDuplicates,
  mergeAccounts,
  mergeContacts,
} from "../src/crm/foundation.js";

const context = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
};

test("account duplicate detection is tenant scoped and weighted", async () => {
  let sql = "";
  const client = {
    query: async (text) => {
      sql = text;
      return { rows: [] };
    },
  };
  await findAccountDuplicates(client, context, {
    legalName: "Acme Pvt Ltd",
    gstin: "27ABCDE1234Z5",
  });
  assert.match(sql, /party\.organization_id = \$1/);
  assert.match(sql, /match_score/);
  assert.match(sql, /gstin/);
});

test("contact duplicate detection normalizes email and phone", async () => {
  let values;
  const client = {
    query: async (_sql, params) => {
      values = params;
      return { rows: [] };
    },
  };
  await findContactDuplicates(client, context, {
    email: " A@Example.COM ",
    mobile: "+91 98765 43210",
  });
  assert.equal(values[1], "a@example.com");
  assert.equal(values[2], "919876543210");
});

test("merge commands reject self merge before database mutation", async () => {
  const client = {
    query: async () => {
      throw new Error("should not query");
    },
  };
  await assert.rejects(
    () =>
      mergeAccounts(
        client,
        context,
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000010",
      ),
    /different accounts/,
  );
  await assert.rejects(
    () =>
      mergeContacts(
        client,
        context,
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000010",
      ),
    /different contacts/,
  );
});
