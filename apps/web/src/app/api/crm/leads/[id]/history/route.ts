import { getLead, listLeadHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// The audit trail. Loading the lead first is what enforces visibility.
export async function GET(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) => {
    const context = crmContext(session);
    const { id } = await route.params;
    await getLead(client, context, id);
    return ok({ history: await listLeadHistory(client, context, id) });
  });
}
