import { createContact, listContacts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { contactFiltersFromUrl, readBody } from "@/features/crm/contacts/server/contact-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView }, async ({ client, session }) => {
    const { contacts, ...page } = await listContacts(client, crmContext(session), contactFiltersFromUrl(new URL(request.url)));
    return ok({ rows: contacts, ...page });
  });
}

// Body: the contact fields (accountId optional), plus allowDuplicate: true to
// save despite a strong duplicate and makePrimary: true to make the person the
// account's primary contact. A duplicate is refused with 409 and its matches.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsCreate, billingWrite: true }, async ({ client, session }) => {
    const { allowDuplicate, makePrimary, ...input } = await readBody(request);
    const record = await createContact(client, crmContext(session), input, { allowDuplicate: allowDuplicate === true, makePrimary: makePrimary === true });
    return ok({ record }, 201);
  });
}
