import { createAccountContact, linkContact, listAccountContacts, searchLinkableContacts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// The account's contacts; with ?linkable=<search>, the contacts that could be
// linked to it instead.
export async function GET(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) => {
    const context = crmContext(session);
    const { id } = await route.params;
    const linkable = new URL(request.url).searchParams.get("linkable");
    if (linkable !== null) return ok({ contacts: await searchLinkableContacts(client, context, id, linkable) });
    return ok({ contacts: await listAccountContacts(client, context, id) });
  });
}

// Body: { contactId } links an existing contact; otherwise the body is a new
// contact (firstName, lastName, email, mobile, …, department, isDecisionMaker, makePrimary).
export async function POST(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { id } = await route.params;
    const body = await readBody(request);
    if (typeof body.contactId === "string") return ok(await linkContact(client, context, id, body.contactId));
    return ok({ contact: await createAccountContact(client, context, id, body) }, 201);
  });
}
