import assert from "node:assert/strict";
import test from "node:test";

import { listApprovals, decideApproval, ApprovalError } from "../src/core/approvals.js";

function baseSession(overrides = {}) {
  return {
    organizationId: "org-1",
    userId: "user-1",
    activeCompanyId: "company-1",
    activeBranchId: null,
    roleSlugs: ["finance_manager"],
    permissions: ["accounting.journal.approve"],
    ...overrides,
  };
}

test("listApprovals defaults to pending and scopes strictly by organization", async () => {
  let capturedValues;
  const client = {
    query: async (sql, values) => {
      capturedValues = values;
      return { rows: [{ id: "a-1", status: "pending" }] };
    },
  };
  const rows = await listApprovals(client, baseSession({ permissions: ["approvals.manage"] }));
  assert.deepEqual(capturedValues, ["org-1", "pending", true, "user-1", 100]);
  assert.equal(rows.length, 1);
});

// Regression guard for SEC-APPROVAL-002 (ERP completion gap audit):
// listApprovals used to take a bare organizationId and return every
// pending approval org-wide to any authenticated member — GET
// /api/approvals had no further permission or assignment check. Now
// scopes to the caller's own requested/assigned rows unless they hold
// approvals.manage (asserted via the "canManage" bound parameter the SQL
// ORs against requested_by/assigned_to).
test("listApprovals scopes to the caller's own requested/assigned rows without approvals.manage", async () => {
  let capturedValues;
  const client = {
    query: async (sql, values) => {
      capturedValues = values;
      return { rows: [] };
    },
  };
  await listApprovals(client, baseSession({ permissions: [] }), { status: "all" });
  assert.deepEqual(capturedValues, ["org-1", null, false, "user-1", 100]);
});

test("decideApproval 404s when the approval does not exist in this organisation", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    decideApproval(client, baseSession(), "missing-id", { decision: "approved" }),
    (error) => error instanceof ApprovalError && error.status === 404,
  );
});

test("decideApproval rejects deciding on an already-decided request", async () => {
  const client = {
    query: async () => ({ rows: [{ id: "a-1", status: "approved", requested_by: "someone-else", command_key: "accounting.journal.approve", command_payload: {}, version: 1 }] }),
  };
  await assert.rejects(
    decideApproval(client, baseSession(), "a-1", { decision: "approved" }),
    (error) => error instanceof ApprovalError && error.status === 409,
  );
});

test("decideApproval blocks the requester from approving their own request (self-approval)", async () => {
  const client = {
    query: async () => ({ rows: [{ id: "a-1", status: "pending", requested_by: "user-1", command_key: "accounting.journal.approve", command_payload: {}, version: 1 }] }),
  };
  await assert.rejects(
    decideApproval(client, baseSession(), "a-1", { decision: "approved" }),
    (error) => error instanceof ApprovalError && error.code === "SELF_APPROVAL_DENIED",
  );
});

test("decideApproval requires a note when rejecting (packages/workflows' own rule)", async () => {
  const client = {
    query: async () => ({ rows: [{ id: "a-1", status: "pending", requested_by: "someone-else", command_key: "accounting.journal.approve", command_payload: {}, version: 1 }] }),
  };
  await assert.rejects(decideApproval(client, baseSession(), "a-1", { decision: "rejected" }));
});

test("decideApproval fails closed (501) for a command_key with no registered dispatch handler", async () => {
  const client = {
    query: async () => ({ rows: [{ id: "a-1", status: "pending", requested_by: "someone-else", command_key: "unknown.module.command", command_payload: {}, version: 1 }] }),
  };
  await assert.rejects(
    decideApproval(client, baseSession(), "a-1", { decision: "approved" }),
    (error) => error instanceof ApprovalError && error.status === 501 && error.code === "APPROVAL_COMMAND_NOT_SUPPORTED",
  );
});

test("decideApproval with 'cancelled' never dispatches to a module handler, only flips the request status", async () => {
  let updateSql;
  const client = {
    query: async (sql) => {
      if (/FOR UPDATE/.test(sql)) {
        return { rows: [{ id: "a-1", status: "pending", requested_by: "user-1", command_key: "unknown.module.command", command_payload: {}, version: 1 }] };
      }
      if (/^UPDATE public\.approval_requests/.test(sql)) {
        updateSql = sql;
        return { rows: [{ id: "a-1", status: "cancelled", decided_at: new Date() }] };
      }
      return { rows: [] };
    },
  };
  const result = await decideApproval(client, baseSession({ userId: "user-1" }), "a-1", { decision: "cancelled", note: "no longer needed" });
  assert.equal(result.approval.status, "cancelled");
  assert.equal(result.outcome, null);
  assert.ok(updateSql);
});

// Regression guard for SEC-APPROVAL-001 (ERP completion gap audit): the SoD
// check above is deliberately skipped for "cancelled" (the requester
// withdrawing their own request is normal) — but that used to leave
// cancellation of someone ELSE's pending request completely unchecked, no
// permission needed at all. Only the original requester or an
// approvals.manage holder may cancel someone else's request now.
test("decideApproval blocks a random org member (not the requester, no approvals.manage) from cancelling someone else's request", async () => {
  const client = {
    query: async () => ({ rows: [{ id: "a-1", status: "pending", requested_by: "someone-else", command_key: "unknown.module.command", command_payload: {}, version: 1 }] }),
  };
  await assert.rejects(
    decideApproval(client, baseSession({ userId: "bystander-1", permissions: [] }), "a-1", { decision: "cancelled", note: "not my call" }),
    (error) => error instanceof ApprovalError && error.status === 403 && error.code === "CANCEL_NOT_PERMITTED",
  );
});

test("decideApproval allows an approvals.manage holder to cancel someone else's request", async () => {
  let updateSql;
  const client = {
    query: async (sql) => {
      if (/FOR UPDATE/.test(sql)) {
        return { rows: [{ id: "a-1", status: "pending", requested_by: "someone-else", command_key: "unknown.module.command", command_payload: {}, version: 1 }] };
      }
      if (/^UPDATE public\.approval_requests/.test(sql)) {
        updateSql = sql;
        return { rows: [{ id: "a-1", status: "cancelled", decided_at: new Date() }] };
      }
      return { rows: [] };
    },
  };
  const result = await decideApproval(
    client,
    baseSession({ userId: "manager-1", permissions: ["approvals.manage"] }),
    "a-1",
    { decision: "cancelled", note: "reassigning ownership" },
  );
  assert.equal(result.approval.status, "cancelled");
  assert.ok(updateSql);
});
