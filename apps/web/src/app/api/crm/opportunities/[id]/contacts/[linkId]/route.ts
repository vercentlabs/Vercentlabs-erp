import { removeOpportunityContact, updateOpportunityContact } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

type LinkParams = { params: Promise<{ id: string; linkId: string }> };

// Body: { role?, notes?, isPrimary?: true }
export async function PATCH(request: Request, route: LinkParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, linkId } = await route.params;
    return ok({ contacts: await updateOpportunityContact(client, crmContext(session), id, linkId, await readBody(request)) });
  });
}

export async function DELETE(request: Request, route: LinkParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, linkId } = await route.params;
    return ok({ contacts: await removeOpportunityContact(client, crmContext(session), id, linkId) });
  });
}
