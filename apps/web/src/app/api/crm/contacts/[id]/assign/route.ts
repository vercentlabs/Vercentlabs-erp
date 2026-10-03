import { assignContact } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

// Body: { ownerUserId?, teamId?, reason? } — an absent key is unchanged, null clears it.
// The operation decides whether this is an assignment or a reassignment.
export async function POST(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView, billingWrite: true }, async ({ client, session }) =>
    ok(await assignContact(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
