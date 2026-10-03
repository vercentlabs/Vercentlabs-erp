import { deleteLeadAssignmentRule, saveLeadAssignmentRule } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

export async function PATCH(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView, billingWrite: true }, async ({ client, session }) =>
    ok({ rule: await saveLeadAssignmentRule(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}

// Only a rule that never assigned a lead can be deleted; others are deactivated.
export async function DELETE(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView, billingWrite: true }, async ({ client, session }) => {
    await deleteLeadAssignmentRule(client, crmContext(session), (await route.params).id);
    return ok({});
  });
}
