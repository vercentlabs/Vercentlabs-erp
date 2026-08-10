import assert from "node:assert/strict";
import test from "node:test";

import { claimOutboxEvents, completeOutboxEvent, failOutboxEvent, DEFAULT_MAX_OUTBOX_ATTEMPTS } from "../src/outbox.js";

const org = "11111111-1111-4111-8111-111111111111";

function mockClient(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [pattern, respond] of handlers) {
        if (pattern.test(sql)) return respond(params);
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("claimOutboxEvents: claims pending/failed due rows OR processing rows whose lease (locked_at) has expired", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.crm_outbox_events/,
      (params) => {
        assert.equal(params[0], org);
        return { rows: [{ id: "evt-1" }] };
      },
    ],
  ]);
  const rows = await claimOutboxEvents(client, org, { workerId: "worker-1", leaseMilliseconds: 60_000 });
  assert.equal(rows.length, 1);
  assert.match(client.calls[0].sql, /status IN \('pending', 'failed'\) AND next_attempt_at <= now\(\)/);
  assert.match(client.calls[0].sql, /status = 'processing' AND locked_at < now\(\) - /);
  assert.match(client.calls[0].sql, /FOR UPDATE SKIP LOCKED/);
});

test("completeOutboxEvent: marks delivered, records provider message id and receipt", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.crm_outbox_events\s+SET status = 'delivered'/,
      (params) => {
        assert.equal(params[2], "msg-123");
        return { rows: [{ id: "evt-1", status: "delivered" }] };
      },
    ],
  ]);
  const result = await completeOutboxEvent(client, "evt-1", "worker-1", { providerMessageId: "msg-123", deliveryReceipt: { statusCode: 200 } });
  assert.equal(result.status, "delivered");
});

test("failOutboxEvent: retryable failure returns to 'failed' with next_attempt_at in the future", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.crm_outbox_events\s+SET status = CASE/,
      (params) => {
        assert.equal(params[4], DEFAULT_MAX_OUTBOX_ATTEMPTS);
        assert.equal(params[5], false);
        return { rows: [{ id: "evt-1", status: "failed" }] };
      },
    ],
  ]);
  const result = await failOutboxEvent(client, "evt-1", "worker-1", { error: "500", backoffMilliseconds: 60_000 });
  assert.equal(result.status, "failed");
});

test("failOutboxEvent: forceDead=true (a terminal error) moves straight to dead_letter regardless of attempt_count", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.crm_outbox_events\s+SET status = CASE/,
      (params) => {
        assert.equal(params[5], true);
        return { rows: [{ id: "evt-1", status: "dead_letter" }] };
      },
    ],
  ]);
  const result = await failOutboxEvent(client, "evt-1", "worker-1", { error: "SSRF blocked", backoffMilliseconds: 60_000, forceDead: true });
  assert.equal(result.status, "dead_letter");
  assert.match(client.calls[0].sql, /WHEN \$6 OR attempt_count >= \$5 THEN 'dead_letter'/);
});
