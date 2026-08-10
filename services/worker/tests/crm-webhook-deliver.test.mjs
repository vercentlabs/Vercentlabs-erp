import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { findMatchingSubscriptions, deliverOutboxEvent } from "../src/handlers/crm-webhook-deliver.js";

const org = "11111111-1111-4111-8111-111111111111";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("findMatchingSubscriptions: scopes by organization, active status, and event_type membership", async () => {
  const client = {
    async query(sql, params) {
      assert.match(sql, /status = 'active' AND \$2 = ANY\(event_types\)/);
      assert.equal(params[0], org);
      assert.equal(params[1], "lead.created");
      return { rows: [{ id: "sub-1", endpoint_url: "https://example.com/hook" }] };
    },
  };
  const rows = await findMatchingSubscriptions(client, org, "lead.created");
  assert.equal(rows.length, 1);
});

test("deliverOutboxEvent: zero matching subscriptions is a clean success (nothing to deliver to is not an error)", async () => {
  const result = await deliverOutboxEvent([], { id: "evt-1", event_type: "lead.created" }, { webhookTimeoutMilliseconds: 1000 });
  assert.equal(result.outcome, "success");
  assert.equal(result.matchedSubscriptions, 0);
});

test("deliverOutboxEvent: exactly one matching subscription — success reflects that subscription's real outcome", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("ok");
  });
  const port = await listen(server);
  try {
    const result = await deliverOutboxEvent(
      [{ id: "sub-1", endpoint_url: `http://127.0.0.1:${port}/hook` }],
      { id: "evt-1", event_type: "lead.created", entity_type: "lead", entity_id: "lead-1", payload: {}, created_at: new Date().toISOString() },
      { webhookTimeoutMilliseconds: 5000, allowPrivateWebhookTargets: true },
    );
    assert.equal(result.outcome, "success");
    assert.equal(result.matchedSubscriptions, 1);
  } finally {
    await close(server);
  }
});

test("deliverOutboxEvent: one failing subscription among several makes the whole event retryable (documented fan-out limitation)", async () => {
  const goodServer = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end();
  });
  const badServer = http.createServer((_request, response) => {
    response.writeHead(500);
    response.end();
  });
  const goodPort = await listen(goodServer);
  const badPort = await listen(badServer);
  try {
    const result = await deliverOutboxEvent(
      [
        { id: "sub-good", endpoint_url: `http://127.0.0.1:${goodPort}/hook` },
        { id: "sub-bad", endpoint_url: `http://127.0.0.1:${badPort}/hook` },
      ],
      { id: "evt-1", event_type: "lead.created", payload: {}, created_at: new Date().toISOString() },
      { webhookTimeoutMilliseconds: 5000, allowPrivateWebhookTargets: true },
    );
    assert.equal(result.outcome, "retryable");
    assert.equal(result.deliveries.length, 2);
  } finally {
    await Promise.all([close(goodServer), close(badServer)]);
  }
});

test("deliverOutboxEvent: a terminal-only failure (e.g. 404) is classified terminal, not retryable", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  try {
    const result = await deliverOutboxEvent(
      [{ id: "sub-1", endpoint_url: `http://127.0.0.1:${port}/hook` }],
      { id: "evt-1", event_type: "lead.created", payload: {}, created_at: new Date().toISOString() },
      { webhookTimeoutMilliseconds: 5000, allowPrivateWebhookTargets: true },
    );
    assert.equal(result.outcome, "terminal");
  } finally {
    await close(server);
  }
});
