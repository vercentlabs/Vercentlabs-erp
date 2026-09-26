// Every job type the worker can run has a human presentation entry, so the
// jobs screen never falls back to a raw job key for real work.
import assert from "node:assert/strict";
import test from "node:test";

import { JOB_TYPE_PRESENTATION } from "../../src/core/platform/jobs/index.js";
import { registerBuiltinHandlers } from "../../../worker/src/handlers/index.js";
import { _resetRegistryForTests, listRegisteredJobTypes } from "../../../worker/src/registry.js";

test("worker job types and the job presentation registry match exactly", () => {
  _resetRegistryForTests();
  registerBuiltinHandlers();
  const registered = listRegisteredJobTypes().sort();
  _resetRegistryForTests();
  assert.deepEqual(JOB_TYPE_PRESENTATION.map((entry) => entry.jobType).sort(), registered);
});
