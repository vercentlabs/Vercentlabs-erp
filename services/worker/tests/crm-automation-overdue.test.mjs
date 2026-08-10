import assert from "node:assert/strict";
import test from "node:test";

import { detectOverdueActivitiesHandler } from "../src/handlers/crm-automation-overdue.js";
import { buildSystemContext } from "../src/system-context.js";

const org = "11111111-1111-4111-8111-111111111111";

function mockClient(overdueRows, transitioned = overdueRows) {
  const queries = [];
  let transitionIndex = 0;
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT \* FROM tenant\.crm_activities\s+WHERE organization_id = \$1\s+AND status IN \('planned', 'in_progress'\)/.test(sql)) {
        return { rows: overdueRows };
      }
      if (/UPDATE tenant\.crm_activities\s+SET status = 'overdue'/.test(sql)) {
        const row = transitioned[transitionIndex];
        transitionIndex += 1;
        return { rows: row ? [row] : [] };
      }
      // runCrmAutomation's own queries — no active rules configured in this test, so it should just query and find none.
      if (/SELECT \* FROM tenant\.crm_automation_rules/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("detectOverdueActivitiesHandler: scopes the scan to the caller's own organization", async () => {
  const client = mockClient([]);
  await detectOverdueActivitiesHandler(client, buildSystemContext(org), {});
  assert.equal(client.queries[0].params[0], org);
});

test("detectOverdueActivitiesHandler: transitions each overdue activity and fires automation for it", async () => {
  const activity = { id: "act-1", status: "planned", due_at: "2020-01-01T00:00:00Z" };
  const client = mockClient([activity], [{ ...activity, status: "overdue" }]);
  const result = await detectOverdueActivitiesHandler(client, buildSystemContext(org), {});
  assert.equal(result.scanned, 1);
  assert.equal(result.fired, 1);
});

test("detectOverdueActivitiesHandler: idempotent — an activity already transitioned by a concurrent tick (UPDATE matches zero rows) is not re-fired", async () => {
  const activity = { id: "act-1", status: "planned", due_at: "2020-01-01T00:00:00Z" };
  // The UPDATE's WHERE clause won't match (already 'overdue' by the time this tick runs) — simulate zero rows returned.
  const client = mockClient([activity], []);
  const result = await detectOverdueActivitiesHandler(client, buildSystemContext(org), {});
  assert.equal(result.scanned, 1);
  assert.equal(result.fired, 0, "must skip firing automation for an activity another tick already claimed");
});

test("detectOverdueActivitiesHandler: no overdue activities is a clean no-op, not an error", async () => {
  const client = mockClient([]);
  const result = await detectOverdueActivitiesHandler(client, buildSystemContext(org), {});
  assert.deepEqual(result, { scanned: 0, fired: 0 });
});
