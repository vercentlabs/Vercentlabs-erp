import { setPrimaryContact, unlinkContact, updateAccountContactRole } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/accounts/server/account-http";

type Params = { params: Promise<{ id: string; contactId: string }> };

// Body: { department?, isDecisionMaker?, isPrimary? }
export async function PATCH(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { id, contactId } = await route.params;
    const { isPrimary, ...role } = await readBody(request);
    if (isPrimary === true) await setPrimaryContact(client, context, id, contactId);
    if (Object.keys(role).length) await updateAccountContactRole(client, context, id, contactId, role);
    return ok({ changed: true });
  });
}

// Unlinks the contact; it stays in CRM without a company.
export async function DELETE(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, contactId } = await route.params;
    return ok(await unlinkContact(client, crmContext(session), id, contactId));
  });
}
