import assert from "node:assert/strict";
import test from "node:test";

import { evaluateWorkerHealth, startWorkerHealthServer } from "../src/health.js";

const config = { worker: { pollIntervalMilliseconds: 5_000, leaseMilliseconds: 120_000, healthPort: 0 } };
const now = 1_000_000_000;

test("liveness never depends on work outcomes; readiness tracks polling", () => {
  assert.deepEqual(evaluateWorkerHealth({ startedAt: null }, config, now), { live: true, ready: false, reason: "starting" });
  assert.equal(evaluateWorkerHealth({ startedAt: now - 10, pollStartedAt: now - 5, pollCompletedAt: now - 4 }, config, now).ready, true);
  // A long job keeps the worker ready while it is inside its lease.
  assert.equal(evaluateWorkerHealth({ startedAt: 1, pollStartedAt: now - 60_000, pollCompletedAt: now - 70_000 }, config, now).ready, true);
  // No completed poll for a long time: not ready, but still live.
  const stale = evaluateWorkerHealth({ startedAt: 1, pollStartedAt: now - 600_000, pollCompletedAt: now - 590_000 }, config, now);
  assert.deepEqual([stale.live, stale.ready, stale.reason], [true, false, "poll-stale"]);
  assert.equal(evaluateWorkerHealth({ startedAt: 1, stopping: true }, config, now).ready, false);
});

test("the probe server answers /livez and /readyz", async () => {
  const state = { startedAt: null };
  const probes = startWorkerHealthServer(state, config, { port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => probes.server.once("listening", resolve));
  const base = `http://127.0.0.1:${probes.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/livez`)).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
    Object.assign(state, { startedAt: Date.now(), pollStartedAt: Date.now(), pollCompletedAt: Date.now() });
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
    assert.equal((await fetch(`${base}/other`)).status, 404);
  } finally {
    await probes.close();
  }
});
