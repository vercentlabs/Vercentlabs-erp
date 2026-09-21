import assert from "node:assert/strict";
import test from "node:test";

import { createBillingClient } from "../src/billing.js";

test("billing client creates same-origin subscription checkout", async () => {
  let request;
  const client = createBillingClient({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({ ok: true, checkoutSessionId: "x" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await client.createCheckout("price-id", 6);
  assert.equal(request.url, "/api/billing/checkout");
  assert.equal(request.options.method, "POST");
  assert.match(request.options.body, /price-id/);
  assert.match(request.options.body, /"users":6/);
});
