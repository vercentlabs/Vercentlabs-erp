import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { registerJobHandler, getJobHandler, listRegisteredJobTypes, validatePayload, HandlerValidationError, _resetRegistryForTests } from "../src/registry.js";

test("registerJobHandler / getJobHandler: round-trips a definition", () => {
  _resetRegistryForTests();
  registerJobHandler("test.job", { schema: z.object({ x: z.number() }), handler: async () => {}, backoff: () => 1000 });
  const definition = getJobHandler("test.job");
  assert.equal(definition.jobType, "test.job");
  assert.deepEqual(listRegisteredJobTypes(), ["test.job"]);
});

test("registerJobHandler: rejects a duplicate job type registration", () => {
  _resetRegistryForTests();
  registerJobHandler("test.job", { handler: async () => {}, backoff: () => 1000 });
  assert.throws(() => registerJobHandler("test.job", { handler: async () => {}, backoff: () => 1000 }), /already registered/);
});

test("registerJobHandler: requires a handler function and a backoff function", () => {
  _resetRegistryForTests();
  assert.throws(() => registerJobHandler("test.job", { backoff: () => 1000 }), /requires a handler function/);
  assert.throws(() => registerJobHandler("test.job", { handler: async () => {} }), /requires a backoff/);
});

test("validatePayload: a malformed persisted payload fails deterministically rather than crashing the caller", () => {
  const definition = { jobType: "test.job", schema: z.object({ x: z.number() }).strict() };
  assert.throws(() => validatePayload(definition, { x: "not a number" }), HandlerValidationError);
  assert.throws(() => validatePayload(definition, { x: 1, extra: "field" }), HandlerValidationError);
});

test("validatePayload: a well-formed payload passes through", () => {
  const definition = { jobType: "test.job", schema: z.object({ x: z.number() }).strict() };
  assert.deepEqual(validatePayload(definition, { x: 5 }), { x: 5 });
});

test("validatePayload: a handler with no schema passes the payload through unchanged", () => {
  assert.deepEqual(validatePayload({ jobType: "test.job" }, { anything: true }), { anything: true });
});

test("registerJobHandler: managed transaction mode is explicit and invalid modes fail closed", () => {
  _resetRegistryForTests();
  registerJobHandler("managed.job", {
    handler: async () => {},
    backoff: () => 1000,
    transactionMode: "managed",
  });
  assert.equal(getJobHandler("managed.job")?.transactionMode, "managed");
  assert.throws(
    () =>
      registerJobHandler("invalid.job", {
        handler: async () => {},
        backoff: () => 1000,
        transactionMode: "implicit-global-transaction",
      }),
    /invalid transactionMode/,
  );
});
