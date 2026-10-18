import { getLeadConnector, updateLeadConnector } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage }, async ({ client, session, snapshot }) =>
    ok({ connector: await getLeadConnector(client, crmContext(session, snapshot), id) }));
}

// Credentials given replace those kept; those left empty stay as they are.
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ connector: await updateLeadConnector(client, crmContext(session, snapshot), id, await readBody(request)) }));
}
