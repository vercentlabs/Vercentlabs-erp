import assert from "node:assert/strict";
import test from "node:test";
import { createCrmClient } from "../src/crm.js";
test("CRM client builds list filters", async () => {
  let request;
  const client = createCrmClient({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, rows: [] }),
      };
    },
  });
  await client.list("leads", { status: "qualified", search: "Pune" });
  assert.match(request.url, /\/api\/crm\/leads\?/);
  assert.match(request.url, /status=qualified/);
});
test("CRM client exposes conversion and stage actions", async () => {
  const calls = [];
  const client = createCrmClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  await client.convertLead("lead-1", { createOpportunity: true });
  await client.moveOpportunity("opp-1", "stage-2", "Negotiated");
  assert.equal(calls[0].url, "/api/crm/leads/lead-1/convert");
  assert.equal(calls[1].url, "/api/crm/opportunities/opp-1/stage");
});
