import { updateLeadStage } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Body: { name?, isActive? }. A standard stage cannot be deactivated.
export async function PATCH(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView, billingWrite: true }, async ({ client, session }) =>
    ok({ stage: await updateLeadStage(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}
