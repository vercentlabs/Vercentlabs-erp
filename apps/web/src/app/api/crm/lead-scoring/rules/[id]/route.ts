import { deleteLeadScoringRule, updateLeadScoringRule } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string }> };

// Body: any of { field, operator, value, points, label, isActive }.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await updateLeadScoringRule(client, crmContext(session, snapshot), id, await readBody(request))));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await deleteLeadScoringRule(client, crmContext(session, snapshot), id)));
}
