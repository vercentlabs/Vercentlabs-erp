import assert from "node:assert/strict";
import test from "node:test";

import { assertPrivacyTransition, transitionPrivacyRequest, PrivacyError } from "../src/core/platform/privacy/index.js";

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

// Stage A2 §16 (SEC-002): a real cross-tenant negative test. This mock
// actually evaluates the SQL's own organization_id predicate against
// fixture data (rather than returning canned rows regardless of the
// caller) — a request that genuinely exists, but for a DIFFERENT
// organization than the caller's session, must be indistinguishable from
// a request that does not exist at all: a 404, never a 409/403 that would
// leak "this id is real, just not yours."
test("transitionPrivacyRequest fails closed (404, not a leak) when the request belongs to a different organization", async () => {
  const realOwningOrg = "org-owner-real";
  const requestId = "request-belongs-to-someone-else";
  const client = {
    query: async (sql, values) => {
      if (/FOR UPDATE/.test(sql)) {
        const [id, organizationId] = values;
        if (id === requestId && organizationId === realOwningOrg) return { rows: [{ status: "received" }] };
        return { rows: [] };
      }
      throw new Error(`Unexpected query outside the org-scoped SELECT: ${sql}`);
    },
  };
  await assert.rejects(
    transitionPrivacyRequest(client, { organizationId: "org-attacker" }, requestId, "verified"),
    (error) => error instanceof PrivacyError && error.status === 404,
  );
  // Sanity check the mock itself is a real predicate, not a tautology: the
  // legitimate owning organization CAN transition the same request.
  const result = await transitionPrivacyRequest(
    { query: async (sql, values) => (/FOR UPDATE/.test(sql) ? { rows: [{ status: "received" }] } : { rows: [{ status: "verified", completed_at: null }] }) },
    { organizationId: realOwningOrg },
    requestId,
    "verified",
  );
  assert.equal(result.status, "verified");
});
