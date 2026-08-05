import assert from "node:assert/strict";
import test from "node:test";

import { findCrmDuplicates, mergeCrmLead } from "../src/crm.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
};

test("lead merge retries return the existing merge instead of failing", async () => {
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const targetId = "44444444-4444-4444-8444-444444444444";
  let queryCount = 0;
  const client = {
    async query() {
      queryCount += 1;
      return {
        rows: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            organization_id: context.organizationId,
            source_id: sourceId,
            target_id: targetId,
          },
        ],
      };
    },
  };

  const result = await mergeCrmLead(client, context, sourceId, targetId);

  assert.equal(queryCount, 1);
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.targetId, targetId);
  assert.equal(result.replayed, true);
});

test("lead merge retries cannot redirect an already merged source", async () => {
  const client = {
    async query() {
      return {
        rows: [
          {
            source_id: "33333333-3333-4333-8333-333333333333",
            target_id: "44444444-4444-4444-8444-444444444444",
          },
        ],
      };
    },
  };

  await assert.rejects(
    mergeCrmLead(
      client,
      context,
      "33333333-3333-4333-8333-333333333333",
      "66666666-6666-4666-8666-666666666666",
    ),
    /already been merged into another lead/,
  );
});

test("inactive leads do not produce duplicate suggestions", async () => {
  let queried = false;
  const client = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };

  assert.deepEqual(
    await findCrmDuplicates(client, context, { status: "archived" }),
    [],
  );
  assert.equal(queried, false);
});

test("duplicate searches exclude archived and converted candidates", async () => {
  let statement = "";
  const client = {
    async query(sql) {
      statement = sql;
      return { rows: [] };
    },
  };

  await findCrmDuplicates(client, context, {
    status: "new",
    email: "lead@example.com",
  });

  assert.match(statement, /record\.status NOT IN \('converted','archived'\)/);
});
