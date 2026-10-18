import { updateAccountTaxIdentity } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// Body: { gstin?, pan?, gstTreatment?, paymentTermId?, expectedUpdatedAt? }. Sets the company's tax identity and terms (a customer's stay
// with Sales while the organization has Sales). Returns the company and anything to look into, such as a GSTIN in another state.
export async function PATCH(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session, snapshot }) => {
    const { id } = await route.params;
    return ok(await updateAccountTaxIdentity(client, crmContext(session, snapshot), id, await readBody(request)));
  });
}
