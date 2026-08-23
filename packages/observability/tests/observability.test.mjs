import assert from "node:assert/strict";
import test from "node:test";

import {
  createLogger,
  createMetricRegistry,
  currentContext,
  normalizeError,
  redact,
  reportError,
  runWithContext,
  withSpan,
} from "../src/index.js";

test("structured logging redacts secrets and carries correlation context", () => {
  const output = [];
  const sink = {
    log: (line) => output.push(line),
    warn: (line) => output.push(line),
    error: (line) => output.push(line),
  };

  runWithContext(
    { requestId: "request-12345678" },
    () =>
      createLogger("test", sink).info("accepted", {
        password: "unsafe",
        nested: { apiKey: "unsafe" },
      }),
  );

  const record = JSON.parse(output[0]);
  assert.equal(record.requestId, "request-12345678");
  assert.equal(record.password, "[REDACTED]");
  assert.equal(record.nested.apiKey, "[REDACTED]");
  assert.deepEqual(
    redact({ authorization: "Bearer secret" }),
    { authorization: "[REDACTED]" },
  );
});

test("metric registry supports counters, gauges and histogram summaries", () => {
  const metrics = createMetricRegistry();

  metrics.increment("http.requests", 1, { route: "/health" });
  metrics.increment("http.requests", 2, { route: "/health" });
  metrics.gauge("worker.depth", 4);
  metrics.observe("http.duration_ms", 20);
  metrics.observe("http.duration_ms", 40);

  const snapshot = metrics.snapshot();

  assert.equal(snapshot.counters[0].value, 3);
  assert.equal(snapshot.gauges[0].value, 4);
  assert.equal(snapshot.histograms[0].count, 2);
  assert.equal(snapshot.histograms[0].sum, 60);
  assert.equal(snapshot.histograms[0].min, 20);
  assert.equal(snapshot.histograms[0].max, 40);
});

test("spans preserve request context and emit trace/span identifiers", async () => {
  let ended;

  await runWithContext(
    { requestId: "request-abcdefgh" },
    async () => {
      await withSpan(
        "test.operation",
        { feature: "platform" },
        async (span) => {
          const context = currentContext();
          assert.equal(context.requestId, "request-abcdefgh");
          assert.equal(context.traceId, span.traceId);
          assert.equal(context.spanId, span.spanId);
        },
        { onEnd: (span) => { ended = span; } },
      );
    },
  );

  assert.equal(ended.status, "ok");
  assert.equal(ended.name, "test.operation");
  assert.ok(ended.durationMilliseconds >= 0);
});

test("error normalization and reporting are safe and structured", () => {
  const output = [];
  const logger = createLogger("errors", {
    log: (line) => output.push(line),
    warn: (line) => output.push(line),
    error: (line) => output.push(line),
  });

  const error = Object.assign(new Error("boom"), { code: "BOOM" });
  const normalized = reportError(logger, error, { token: "unsafe" });

  assert.equal(normalized.code, "BOOM");
  const record = JSON.parse(output[0]);
  assert.equal(record.token, "[REDACTED]");
  assert.equal(record.error.code, "BOOM");
  assert.equal(normalizeError("bad").name, "NonErrorThrown");
});
