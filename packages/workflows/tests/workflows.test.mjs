import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovalDecision, assertSeparationOfDuties, createCommandRegistry, WorkflowConflictError } from "../src/index.js";

test("approvals require separation of duties and rejection evidence", () => {
  assert.throws(() => assertSeparationOfDuties({ requestedBy: "one", actorUserId: "one" }), WorkflowConflictError);
  assert.throws(() => assertApprovalDecision({ decision: "rejected" }), TypeError);
  assert.equal(assertApprovalDecision({ decision: "approved", expectedVersion: 2 }).decision, "approved");
});

test("command execution is restricted to the allowlist", async () => {
  const registry = createCommandRegistry([{ key: "crm.test", validate: (value) => value, execute: async (_context, value) => value }]);
  await assert.doesNotReject(registry.execute("crm.test", {}, { safe: true }));
  assert.throws(() => registry.validate("sql.execute", {}), RangeError);
});
