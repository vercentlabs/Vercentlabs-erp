import { removeAccountAddress, updateAccountAddress } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/accounts/server/account-http";

type Params = { params: Promise<{ id: string; addressId: string }> };

export async function PATCH(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, addressId } = await route.params;
    return ok({ address: await updateAccountAddress(client, crmContext(session), id, addressId, await readBody(request)) });
  });
}

// Removing an address deactivates it; documents that printed it keep it.
export async function DELETE(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, addressId } = await route.params;
    return ok(await removeAccountAddress(client, crmContext(session), id, addressId));
  });
}
