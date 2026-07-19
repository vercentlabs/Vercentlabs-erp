import assert from "node:assert/strict";
import test from "node:test";
import { createQueryRecorder, productionGuard, TEST_TENANTS } from "../src/index.js";

test("test fixtures are deterministic and production guarded", async () => {
  assert.notEqual(TEST_TENANTS.alpha.organizationId, TEST_TENANTS.beta.organizationId);
  assert.throws(() => productionGuard({ NODE_ENV: "production" }));
  const client = createQueryRecorder([{ rows: [{ ok: true }] }]);
  assert.deepEqual((await client.query("SELECT $1", [1])).rows, [{ ok: true }]);
});
