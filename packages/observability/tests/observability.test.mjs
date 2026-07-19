import assert from "node:assert/strict";
import test from "node:test";
import { createLogger, redact, runWithContext } from "../src/index.js";

test("structured logging redacts secrets and carries correlation context", () => {
  const output = [];
  const sink = { log: (line) => output.push(line), warn: (line) => output.push(line), error: (line) => output.push(line) };
  runWithContext({ requestId: "request-12345678" }, () => createLogger("test", sink).info("accepted", { password: "unsafe", nested: { apiKey: "unsafe" } }));
  const record = JSON.parse(output[0]);
  assert.equal(record.requestId, "request-12345678");
  assert.equal(record.password, "[REDACTED]");
  assert.equal(record.nested.apiKey, "[REDACTED]");
  assert.deepEqual(redact({ authorization: "Bearer secret" }), { authorization: "[REDACTED]" });
});
