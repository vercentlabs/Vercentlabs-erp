import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assertApprovalDecision,
  assertSeparationOfDuties,
  WorkflowConflictError,
} from "@vercent/workflows";

test("approval decisions require a version and separation of duties", () => {
  assert.throws(
    () => assertApprovalDecision({ decision: "approved" }),
    TypeError,
  );
  assert.throws(
    () =>
      assertSeparationOfDuties({
        requestedBy: "requester",
        actorUserId: "requester",
      }),
    WorkflowConflictError,
  );
  assert.equal(
    assertApprovalDecision({ decision: "approved", expectedVersion: 1 })
      .expectedVersion,
    1,
  );
});

test("approval execution is command-bound and persisted atomically", () => {
  const root = process.cwd();
  const route = fs.readFileSync(
    path.join(root, "src/app/api/approvals/[id]/route.ts"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(
      root,
      "../../database/control-plane/migrations/010_approval_execution.sql",
    ),
    "utf8",
  );
  assert.match(route, /command\.execute/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /approval_decisions/);
  assert.match(migration, /UNIQUE \(approval_request_id, version\)/);
});
