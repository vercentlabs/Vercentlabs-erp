import { getAccountHierarchy, setAccountParent } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// The parent chain and the child accounts.
export async function GET(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) =>
    ok({ hierarchy: await getAccountHierarchy(client, crmContext(session), (await route.params).id) }),
  );
}

// Body: { parentPartyId: uuid | null }
export async function PUT(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) => {
    const { parentPartyId } = await readBody(request);
    return ok(await setAccountParent(client, crmContext(session), (await route.params).id, { parentPartyId: typeof parentPartyId === "string" ? parentPartyId : null }));
  });
}
