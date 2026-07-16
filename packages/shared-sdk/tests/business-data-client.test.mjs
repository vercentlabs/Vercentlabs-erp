import assert from "node:assert/strict";
import test from "node:test";

import { createBusinessDataClient } from "../src/index.js";

test("business-data client builds same-origin list requests", async () => {
  const calls = [];
  const client = createBusinessDataClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true, rows: [], total: 0 }),
      };
    },
  });

  const result = await client.list("items", {
    search: "bearing",
    status: "active",
  });

  assert.equal(result.total, 0);
  assert.equal(
    calls[0].url,
    "/api/business-data/items?search=bearing&status=active",
  );
  assert.equal(calls[0].options.credentials, "same-origin");
});

test("business-data client rejects unsuccessful mutations", async () => {
  const client = createBusinessDataClient({
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      headers: { get: () => "application/json" },
      json: async () => ({ message: "Duplicate record." }),
    }),
  });

  await assert.rejects(
    () => client.create("parties", { code: "CUS-1" }),
    /Duplicate record/,
  );
});
