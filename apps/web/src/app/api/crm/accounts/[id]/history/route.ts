import { getAccount, listAccountHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import type { AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// The account's audit trail. Loading the account first enforces visibility.
export async function GET(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) => {
    const context = crmContext(session);
    const account = await getAccount(client, context, (await route.params).id);
    return ok({ history: await listAccountHistory(client, context, account.id) });
  });
}
