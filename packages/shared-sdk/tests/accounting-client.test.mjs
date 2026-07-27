import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingClient } from "../src/accounting.js";

function response(payload = { ok: true }) { return { ok: true, status: 200, json: async () => payload }; }

test("accounting client builds report filters and same-origin requests", async () => {
  const calls = [];
  const client = createAccountingClient({ fetchImpl: async (url, init) => { calls.push({ url, init }); return response(); } });
  await client.report("trial-balance", { from: "2026-04-01", to: "2026-04-30" });
  await client.createJournal({ description: "Opening" });
  assert.match(calls[0].url, /\/api\/accounting\/reports\/trial-balance\?/);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.credentials, "same-origin");
});

test("accounting client exposes governed subledger, matching, compliance and forecast actions", async () => {
  const calls = [];
  const client = createAccountingClient({ fetchImpl: async (url, init) => { calls.push({ url, init }); return response(); } });
  await client.receivableAction("invoice-id", "submit");
  await client.payableAction("bill-id", "post");
  await client.paymentAction("payment-id", "allocate", { input: { amount: "10" } });
  await client.evaluateVendorBillMatch("bill-id", { matchType: "three_way" });
  await client.updateComplianceRequest("request-id", { status: "completed" });
  await client.generateForecast("forecast-id");
  await client.closeRunAction("close-id", "complete");
  assert.deepEqual(calls.map((call) => call.url), [
    "/api/accounting/receivables/invoices/invoice-id/actions",
    "/api/accounting/payables/bills/bill-id/actions",
    "/api/accounting/payables/payments/payment-id/actions",
    "/api/accounting/payables/bills/bill-id/matching",
    "/api/accounting/compliance/requests/request-id",
    "/api/accounting/forecasts/forecast-id/generate",
    "/api/accounting/close/close-id/actions",
  ]);
  assert.equal(calls[4].init.method, "PATCH");
  assert.ok(calls.every((call) => call.init.credentials === "same-origin"));
});
