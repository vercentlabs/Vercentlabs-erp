import { addOpportunityContact, listOpportunityContacts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ contacts: await listOpportunityContacts(client, crmContext(session), (await route.params).id) }),
  );
}

// Body: { contactId, role?, isPrimary?, notes? } — a contact of the deal's account.
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) =>
    ok({ contacts: await addOpportunityContact(client, crmContext(session), (await route.params).id, await readBody(request)) }, 201),
  );
}
