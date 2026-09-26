import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { deliverWebhook, WebhookDeliveryError } from "../../src/core/platform/integrations/webhooks/transport.js";

// Part 65/66/67: a controlled local HTTP server, no external internet
// dependency. allowPrivateTargets:true is required for these tests since
// the fixture server necessarily listens on 127.0.0.1 — production
// delivery never sets this (see ssrf.test.mjs for the default-blocked
// behavior these tests deliberately bypass).

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("deliverWebhook: a 200 response is classified success and the body is delivered", async () => {
  let received;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  const port = await listen(server);
  try {
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, {
      payload: { eventType: "lead.created" },
      timeoutMilliseconds: 5_000,
      allowPrivateTargets: true,
      deliveryId: "evt-1",
    });
    assert.equal(result.outcome, "success");
    assert.equal(result.statusCode, 200);
    assert.equal(received.eventType, "lead.created");
  } finally {
    await close(server);
  }
});

test("deliverWebhook: a 500 response is classified retryable", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500);
    response.end("server error");
  });
  const port = await listen(server);
  try {
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, {
      payload: {},
      timeoutMilliseconds: 5_000,
      allowPrivateTargets: true,
    });
    assert.equal(result.outcome, "retryable");
    assert.equal(result.statusCode, 500);
  } finally {
    await close(server);
  }
});

test("deliverWebhook: a 404 response is classified terminal — never retried forever", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(404);
    response.end("not found");
  });
  const port = await listen(server);
  try {
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, {
      payload: {},
      timeoutMilliseconds: 5_000,
      allowPrivateTargets: true,
    });
    assert.equal(result.outcome, "terminal");
  } finally {
    await close(server);
  }
});

test("deliverWebhook: 429 is classified retryable and a bounded Retry-After is surfaced", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(429, { "retry-after": "30" });
    response.end();
  });
  const port = await listen(server);
  try {
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, {
      payload: {},
      timeoutMilliseconds: 5_000,
      allowPrivateTargets: true,
    });
    assert.equal(result.outcome, "retryable");
    assert.equal(result.retryAfterMilliseconds, 30_000);
  } finally {
    await close(server);
  }
});

test("deliverWebhook: a hostile Retry-After (years) is capped, not honored literally", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(429, { "retry-after": String(60 * 60 * 24 * 365) });
    response.end();
  });
  const port = await listen(server);
  try {
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, {
      payload: {},
      timeoutMilliseconds: 5_000,
      allowPrivateTargets: true,
    });
    assert.ok(result.retryAfterMilliseconds < 60 * 60 * 24 * 365 * 1000, "must be capped well below a literal one-year wait");
  } finally {
    await close(server);
  }
});

test("deliverWebhook: a slow endpoint times out and is classified retryable, not hung forever", async () => {
  const server = http.createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200);
      response.end("too slow");
    }, 2_000);
  });
  const port = await listen(server);
  try {
    await assert.rejects(
      () =>
        deliverWebhook(`http://127.0.0.1:${port}/hook`, {
          payload: {},
          timeoutMilliseconds: 200,
          allowPrivateTargets: true,
        }),
      (error) => {
        assert.ok(error instanceof WebhookDeliveryError);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    await close(server);
  }
});

test("deliverWebhook: a huge response body is bounded, never fully buffered into memory", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    // 2 MiB of 'x' — far beyond the 64 KiB cap.
    response.end("x".repeat(2 * 1024 * 1024));
  });
  const port = await listen(server);
  try {
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, {
      payload: {},
      timeoutMilliseconds: 5_000,
      allowPrivateTargets: true,
    });
    assert.ok(result.bodyPreview.length <= 2_000, "bodyPreview must be bounded regardless of the real response size");
  } finally {
    await close(server);
  }
});

test("deliverWebhook: SSRF-blocked destination without allowPrivateTargets throws a terminal, non-retryable error before any request is attempted", async () => {
  await assert.rejects(
    () => deliverWebhook("http://127.0.0.1:9/hook", { payload: {}, timeoutMilliseconds: 5_000, allowPrivateTargets: false }),
    (error) => {
      assert.ok(error instanceof WebhookDeliveryError);
      assert.equal(error.retryable, false);
      assert.equal(error.code, "SSRF_BLOCKED");
      return true;
    },
  );
});

test("deliverWebhook: does not follow a redirect (a redirect target has not been SSRF-validated)", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(302, { location: "http://127.0.0.1:9/elsewhere" });
    response.end();
  });
  const port = await listen(server);
  try {
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, {
      payload: {},
      timeoutMilliseconds: 5_000,
      allowPrivateTargets: true,
    });
    assert.equal(result.statusCode, 302, "the 302 itself must be returned, not silently followed");
  } finally {
    await close(server);
  }
});
