import { setPrimaryAccount } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

type Params = { params: Promise<{ id: string; accountId: string }> };

// Makes this company the person's primary company.
export async function POST(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, accountId } = await route.params;
    return ok(await setPrimaryAccount(client, crmContext(session), id, accountId));
  });
}
