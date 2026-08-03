import assert from "node:assert/strict";
import test from "node:test";

import {
  CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS,
  CrmAccountIntelligenceError,
  crmAccountIntelligenceHash,
  getAccountHierarchy,
  getCrmAccountIntelligenceReadiness,
  mergeAccountsGoverned,
  setAccountParent,
} from "../src/crm/account-intelligence.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
};

test("CRM-02 capability contract is exact and hashes are stable", () => {
  assert.deepEqual(CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS, [
    "CRM-027",
    "CRM-028",
    "CRM-029",
    "CRM-030",
    "CRM-035",
  ]);
  assert.equal(
    crmAccountIntelligenceHash({ b: 2, a: 1 }),
    crmAccountIntelligenceHash({ a: 1, b: 2 }),
  );
});

test("account hierarchy is tenant scoped and reports ancestors and descendants", async () => {
  const responses = [
    {
      rows: [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", display_name: "Child" },
      ],
    },
    {
      rows: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          display_name: "Parent",
          depth: 1,
        },
      ],
    },
    {
      rows: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          display_name: "Subsidiary",
          depth: 1,
        },
      ],
    },
    { rows: [] },
  ];
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return responses.shift();
    },
  };
  const result = await getAccountHierarchy(
    client,
    context,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.equal(result.metrics.ancestorCount, 1);
  assert.equal(result.metrics.descendantCount, 1);
  assert.ok(calls.every((call) => call.values[0] === context.organizationId));
  assert.match(calls[1].sql, /WITH RECURSIVE/);
  assert.match(calls[2].sql, /child\.parent_party_id=tree\.id/);
});

test("hierarchy and acceptance gates fail closed", async () => {
  await assert.rejects(
    () =>
      setAccountParent(
        { query: async () => ({ rows: [] }) },
        context,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    (error) =>
      error instanceof CrmAccountIntelligenceError && error.status === 409,
  );
  const client = {
    async query() {
      return {
        rows: [
          {
            capability_id: "CRM-027",
            status: "passed",
            evidence: {},
            recorded_at: new Date().toISOString(),
          },
        ],
      };
    },
  };
  const readiness = await getCrmAccountIntelligenceReadiness(client, context);
  assert.equal(readiness.readiness, "blocked");
  assert.equal(readiness.score, 20);
  assert.equal(readiness.blockers.length, 4);
});

test("governed account merge blocks parent-to-descendant collapse", async () => {
  const source = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "active",
    parent_party_id: null,
  };
  const survivor = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "active",
    parent_party_id: source.id,
  };
  let accountReads = 0;
  const client = {
    async query(sql) {
      if (/id=ANY/.test(sql)) return { rows: [source, survivor] };
      if (/FROM tenant\.business_parties party/.test(sql)) {
        accountReads += 1;
        return { rows: [accountReads === 1 ? source : survivor] };
      }
      if (/pg_constraint/.test(sql)) return { rows: [] };
      if (/WITH RECURSIVE descendants/.test(sql))
        return { rows: [{ exists: 1 }] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    () =>
      mergeAccountsGoverned(client, context, source.id, survivor.id, "test"),
    (error) =>
      error instanceof CrmAccountIntelligenceError &&
      error.code === "CRM_ACCOUNT_MERGE_DESCENDANT_CONFLICT",
  );
});
