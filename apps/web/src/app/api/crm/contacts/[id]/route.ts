import { deleteUnusedContact, getContact, updateContact } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

export async function GET(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView }, async ({ client, session }) =>
    ok({ record: await getContact(client, crmContext(session), (await route.params).id) }),
  );
}

export async function PATCH(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsEdit, billingWrite: true }, async ({ client, session }) => {
    const { allowDuplicate, expectedUpdatedAt, ...input } = await readBody(request);
    const record = await updateContact(client, crmContext(session), (await route.params).id, input, {
      allowDuplicate: allowDuplicate === true,
      expectedUpdatedAt: typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : null,
    });
    return ok({ record });
  });
}

// Permanently deletes a contact created by mistake. Refused when the person
// has opportunities, quotations, orders, tickets or activities; such a contact
// is archived instead.
export async function DELETE(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsDelete, billingWrite: true }, async ({ client, session }) =>
    ok(await deleteUnusedContact(client, crmContext(session), (await route.params).id)),
  );
}
