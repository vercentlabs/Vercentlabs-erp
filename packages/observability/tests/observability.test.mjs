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

test("log records are Cloud Logging structured JSON with severity, deployment identity and events", () => {
  const output = [];
  const sink = { log: (line) => output.push(line), warn: (line) => output.push(line), error: (line) => output.push(line) };
  const previous = { environment: process.env.DEPLOYMENT_ENVIRONMENT, release: process.env.RELEASE_SHA };
  process.env.DEPLOYMENT_ENVIRONMENT = "production";
  process.env.RELEASE_SHA = "abc1234";
  try {
    const logger = createLogger("worker", sink);
    logger.warn("slow");
    logger.event("worker.job.dead", { jobType: "report.run", sessionToken: "unsafe" }, "error");
    reportError(logger, new Error("boom"), { route: "/api/x" });
  } finally {
    if (previous.environment === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT;
    else process.env.DEPLOYMENT_ENVIRONMENT = previous.environment;
    if (previous.release === undefined) delete process.env.RELEASE_SHA;
    else process.env.RELEASE_SHA = previous.release;
  }
  const [warn, event, error] = output.map((line) => JSON.parse(line));
  assert.equal(warn.severity, "WARNING");
  assert.equal(warn.environment, "production");
  assert.equal(warn.release, "abc1234");
  assert.equal(event.severity, "ERROR");
  assert.equal(event.event, "worker.job.dead");
  assert.equal(event.sessionToken, "[REDACTED]");
  assert.equal(event["@type"], undefined, "an event without a stack is not an Error Reporting entry");
  assert.equal(error.severity, "ERROR");
  assert.match(error.stack_trace, /Error: boom/);
  assert.equal(error["@type"], "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent");
  assert.deepEqual(error.serviceContext, { service: "worker", version: "abc1234" });
});
