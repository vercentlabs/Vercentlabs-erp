import { getContact, listContactHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import type { ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

// The contact's audit trail. Loading the contact first enforces visibility.
export async function GET(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView }, async ({ client, session }) => {
    const context = crmContext(session);
    const contact = await getContact(client, context, (await route.params).id);
    return ok({ history: await listContactHistory(client, context, contact.id) });
  });
}
