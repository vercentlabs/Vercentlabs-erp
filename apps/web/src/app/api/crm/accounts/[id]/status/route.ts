import { setAccountStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// Deactivate, reactivate or archive. Body: { status, note? }
export async function POST(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsArchive, billingWrite: true }, async ({ client, session }) => {
    const { status, note } = await readBody(request);
    if (status !== "active" && status !== "inactive" && status !== "archived") throw new HttpError(400, "Choose a status.");
    return ok(await setAccountStatus(client, crmContext(session), (await route.params).id, status, { note: typeof note === "string" ? note : null }));
  });
}
