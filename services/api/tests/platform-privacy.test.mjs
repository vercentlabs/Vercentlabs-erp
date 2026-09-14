import assert from "node:assert/strict";
import test from "node:test";

import { assertPrivacyTransition, transitionPrivacyRequest, PrivacyError } from "../src/core/privacy.js";

test("assertPrivacyTransition allows only the defined finite-state-machine edges", () => {
  assert.doesNotThrow(() => assertPrivacyTransition("received", "verified"));
  assert.doesNotThrow(() => assertPrivacyTransition("verified", "in_progress"));
  assert.doesNotThrow(() => assertPrivacyTransition("in_progress", "completed"));
});

test("assertPrivacyTransition rejects illegal jumps (e.g. skipping straight to completed, or leaving a terminal state)", () => {
  assert.throws(() => assertPrivacyTransition("received", "completed"), PrivacyError);
  assert.throws(() => assertPrivacyTransition("completed", "in_progress"), PrivacyError);
  assert.throws(() => assertPrivacyTransition("rejected", "verified"), PrivacyError);
});

test("transitionPrivacyRequest enforces the same FSM inside the row-locked transaction, not just at the API boundary", async () => {
  const client = {
    query: async (sql) => {
      if (/FOR UPDATE/.test(sql)) return { rows: [{ status: "completed" }] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    transitionPrivacyRequest(client, { organizationId: "org-1" }, "request-1", "in_progress"),
    PrivacyError,
  );
});

test("transitionPrivacyRequest 404s when the request does not exist in this organisation", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    transitionPrivacyRequest(client, { organizationId: "org-1" }, "missing-request", "verified"),
    (error) => error instanceof PrivacyError && error.status === 404,
  );
});
