import { restoreLead } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsDelete, billingWrite: true }, async ({ client, session }) =>
    ok(await restoreLead(client, crmContext(session), (await route.params).id)),
  );
}
