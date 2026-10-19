import { deleteApprovalRule, saveApprovalRule } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { ruleSchema } from "@/features/settings/approval-rules/rule-schema";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { permission: "approvals.manage", action: "approval_rules.update", auditDenial: true }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok({ rule: await saveApprovalRule(client, session, { ...ruleSchema.parse(await readJson(request)), id }) });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { permission: "approvals.manage", action: "approval_rules.delete", auditDenial: true }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok(await deleteApprovalRule(client, session, id));
  });
}
