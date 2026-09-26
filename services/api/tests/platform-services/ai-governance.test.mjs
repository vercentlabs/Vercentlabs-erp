import assert from "node:assert/strict";
import test from "node:test";

import { assertAiActionPolicy, recordAiRequest, AiGovernanceError, AI_POLICY_DISABLED, AI_POLICY_MISSING, AI_APPROVAL_REQUIRED } from "../../src/core/platform/ai/index.js";

test("assertAiActionPolicy fails closed when the policy itself is disabled, regardless of individual flags", () => {
  assert.throws(
    () => assertAiActionPolicy({ enabled: false, allowRead: true, allowPropose: true, allowExecute: true, requiresApproval: false, requestType: "read" }),
    (error) => error instanceof AiGovernanceError && error.code === AI_POLICY_DISABLED,
  );
});

test("assertAiActionPolicy blocks execute-type AI actions that still require a normal approval — AI cannot self-approve", () => {
  assert.throws(
    () => assertAiActionPolicy({ enabled: true, allowRead: true, allowPropose: true, allowExecute: true, requiresApproval: true, requestType: "execute" }),
    (error) => error instanceof AiGovernanceError && error.code === AI_APPROVAL_REQUIRED,
  );
});

test("assertAiActionPolicy allows execute only when explicitly permitted and approval is not required", () => {
  assert.doesNotThrow(() =>
    assertAiActionPolicy({ enabled: true, allowRead: true, allowPropose: true, allowExecute: true, requiresApproval: false, requestType: "execute" }),
  );
});

test("recordAiRequest fails closed with AI_POLICY_MISSING when no organization policy has ever been configured", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    recordAiRequest(client, { organizationId: "org-1", userId: "user-1" }, { policyKey: "default", requestType: "read", prompt: "hello" }),
    (error) => error instanceof AiGovernanceError && error.code === AI_POLICY_MISSING,
  );
});

test("recordAiRequest denies a tool not in the policy's allow-list", async () => {
  const client = {
    query: async () => ({
      rows: [
        {
          enabled: true,
          allow_read: true,
          allow_propose: true,
          allow_execute: true,
          requires_approval: false,
          allowed_tools: ["approved-tool"],
        },
      ],
    }),
  };
  await assert.rejects(
    recordAiRequest(client, { organizationId: "org-1", userId: "user-1" }, {
      policyKey: "default",
      requestType: "propose",
      prompt: "do something",
      actionKey: "unapproved-tool",
    }),
    (error) => error instanceof AiGovernanceError && error.code === "AI_TOOL_DENIED",
  );
});

test("an unregistered AI tool is denied even when the policy lists no tools (never fail-open)", async () => {
  const policyRow = { enabled: true, allow_read: true, allow_propose: true, allow_execute: false, requires_approval: true, allowed_tools: [] };
  const client = { query: async (sql) => (sql.includes("FROM ai_policies") ? { rows: [policyRow] } : { rows: [{ id: "r1", status: "received" }] }) };
  await assert.rejects(
    recordAiRequest(client, { organizationId: "org-1", userId: "user-1" }, { policyKey: "organization", requestType: "read", prompt: "hello", actionKey: "crm.summarize_lead" }),
    (error) => error.code === "AI_TOOL_DENIED",
  );
});

test("the prompt is stored only as a hash", async () => {
  const policyRow = { enabled: true, allow_read: true, allow_propose: true, allow_execute: false, requires_approval: true, allowed_tools: [] };
  const inserts = [];
  const client = { query: async (sql, values) => (sql.includes("FROM ai_policies") ? { rows: [policyRow] } : (inserts.push(values), { rows: [{ id: "r1", status: "received" }] })) };
  await recordAiRequest(client, { organizationId: "org-1", userId: "user-1" }, { policyKey: "organization", requestType: "read", prompt: "customer Asha Rao owes 40000" });
  assert.ok(!JSON.stringify(inserts).includes("Asha Rao"));
  assert.match(inserts[0][4], /^[0-9a-f]{64}$/);
});
