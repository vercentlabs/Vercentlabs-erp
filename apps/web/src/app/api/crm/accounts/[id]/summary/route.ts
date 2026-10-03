import { getAccountSummary } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import type { AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// The Customer 360 summary cards. Sales, Finance, Projects and Support
// figures are included only for callers who can open those modules.
export async function GET(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) =>
    ok({ summary: await getAccountSummary(client, crmContext(session), (await route.params).id) }),
  );
}
