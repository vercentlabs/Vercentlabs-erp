import test from "node:test";
import assert from "node:assert/strict";
import {
  CRM_OFFLINE_CAPABILITY_IDS,
  createOfflineMutationId,
  calculateOfflineRetry,
  normalizeOfflineMutation,
  resolveOfflineConflict,
  compactOfflineChanges,
} from "../src/crm/offline-sync.js";
test("CRM-12 declares offline capability", () =>
  assert.deepEqual(CRM_OFFLINE_CAPABILITY_IDS, ["CRM-072"]));
test("offline mutation ids are deterministic", () =>
  assert.equal(
    createOfflineMutationId({ idempotencyKey: "x", deviceId: "d" }),
    createOfflineMutationId({ idempotencyKey: "x", deviceId: "d" }),
  ));
test("offline retries are bounded", () => {
  assert.equal(calculateOfflineRetry({ attempts: 4 }).retryable, true);
  assert.equal(calculateOfflineRetry({ attempts: 5 }).retryable, false);
});
test("only supported mutations pass", () =>
  assert.throws(
    () =>
      normalizeOfflineMutation({
        resource: "accounts",
        operation: "delete",
        idempotencyKey: "x",
      }),
    /Unsupported/,
  ));
test("conflicts support field merge", () =>
  assert.deepEqual(
    resolveOfflineConflict({
      strategy: "field-merge",
      server: { a: 1, b: 2 },
      client: { a: 9, b: 8 },
      clientFields: ["a"],
    }).resolved,
    { a: 9, b: 2 },
  ));
test("change compaction preserves latest record change", () =>
  assert.equal(
    compactOfflineChanges([
      { resource: "leads", recordId: "1", sequence: 1, payload: { v: 1 } },
      { resource: "leads", recordId: "1", sequence: 2, payload: { v: 2 } },
    ])[0].sequence,
    2,
  ));
