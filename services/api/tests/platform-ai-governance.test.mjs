import assert from "node:assert/strict";
import test from "node:test";

import { assertAiActionPolicy, recordAiRequest, AiGovernanceError, AI_POLICY_DISABLED, AI_POLICY_MISSING, AI_APPROVAL_REQUIRED } from "../src/core/ai-governance.js";

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
