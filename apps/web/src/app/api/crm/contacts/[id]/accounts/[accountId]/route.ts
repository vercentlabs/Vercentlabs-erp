import { updateContactRelationship } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/contacts/server/contact-http";

type Params = { params: Promise<{ id: string; accountId: string }> };

// The person's position at this company. Body: { jobTitle?, department?,
// role?, isDecisionMaker?, status? } — status "inactive" records that they left.
export async function PATCH(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, accountId } = await route.params;
    return ok(await updateContactRelationship(client, crmContext(session), id, accountId, await readBody(request)));
  });
}
