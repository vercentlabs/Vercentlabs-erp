import assert from "node:assert/strict";
import test from "node:test";

import { detectLeadSlaBreachesHandler } from "../src/handlers/crm-lead-sla-scan.js";

const org = "11111111-1111-4111-8111-111111111111";

function mockClient(openCases = []) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM tenant.crm_lead_sla_cases sla") && sql.includes("JOIN tenant.crm_lead_sla_policies policy"))
        return { rows: openCases };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("detectLeadSlaBreachesHandler: scopes the scan to the caller's own organization", async () => {
  const client = mockClient([]);
  await detectLeadSlaBreachesHandler(client, { organizationId: org }, {});
  assert.equal(client.queries[0].params[0], org);
});

test("detectLeadSlaBreachesHandler: builds an elevated sweep context so the scan is not forbidden the way the least-privilege system context would be", async () => {
  // The generic system context (roleSlugs: ["system_worker"], permissions: [])
  // would fail scanLeadSlaBreaches's crm.leads.view_sensitive gate. Reaching
  // the (mocked) query at all - rather than a CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN
  // rejection - proves the handler built its own richer context instead of
  // trusting the one processGenericJob passed in.
  const client = mockClient([]);
  const result = await detectLeadSlaBreachesHandler(client, { organizationId: org, roleSlugs: ["system_worker"], permissions: [] }, {});
  assert.deepEqual(result, { scanned: 0, breached: 0 });
});

test("detectLeadSlaBreachesHandler: no open SLA cases is a clean no-op, not an error", async () => {
  const client = mockClient([]);
  const result = await detectLeadSlaBreachesHandler(client, { organizationId: org }, {});
  assert.deepEqual(result, { scanned: 0, breached: 0 });
});
