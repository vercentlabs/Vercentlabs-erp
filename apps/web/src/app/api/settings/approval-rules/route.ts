import { listApprovalRules, saveApprovalRule } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { ruleSchema } from "@/features/settings/approval-rules/rule-schema";

// Settings › Approval rules: which documents need approval, from what amount, by whom, in up to two levels.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: "approvals.manage", action: "approval_rules.list" }, async ({ client, session }) =>
    ok(await listApprovalRules(client, session)));
}


export async function POST(request: Request) {
  return workspaceRoute(request, { permission: "approvals.manage", action: "approval_rules.create", auditDenial: true }, async ({ client, session }) =>
    ok({ rule: await saveApprovalRule(client, session, ruleSchema.parse(await readJson(request))) }, 201));
}
