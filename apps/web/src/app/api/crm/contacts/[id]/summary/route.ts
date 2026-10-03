import { getContactSummary } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import type { ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

// The contact's summary: company, role, owner, open work and, for people who
// can open those modules, quotations, orders and support tickets.
export async function GET(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView }, async ({ client, session }) =>
    ok({ summary: await getContactSummary(client, crmContext(session), (await route.params).id) }),
  );
}
