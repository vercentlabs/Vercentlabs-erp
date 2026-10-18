import { archiveSalesTeam, getSalesTeam, updateSalesTeam } from "@vercentlabs/api/crm";
import { requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ record: await getSalesTeam(client, crmContext(session, snapshot), id) }));
}

// Body: { input, expectedUpdatedAt } — the version the editor loaded.
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    requireSessionPermission(session, CRM_PERMISSIONS.teamsManage);
    const body = await readBody(request);
    const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, unknown>;
    return ok({ record: await updateSalesTeam(client, crmContext(session, snapshot), id, input, { expectedUpdatedAt: String(body.expectedUpdatedAt ?? "") }) });
  });
}

// Archives the team (status inactive): ?expectedUpdatedAt=
export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt") ?? "";
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    requireSessionPermission(session, CRM_PERMISSIONS.teamsManage);
    return ok({ record: await archiveSalesTeam(client, crmContext(session, snapshot), id, { expectedUpdatedAt }) });
  });
}
