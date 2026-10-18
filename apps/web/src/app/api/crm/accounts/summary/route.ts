import { getAccountListSummary } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { accountFiltersFromUrl } from "@/features/crm/accounts/server/account-http";

// The summary cards above the account list, for the same view and filters.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session, snapshot }) =>
    ok({ summary: await getAccountListSummary(client, crmContext(session, snapshot), accountFiltersFromUrl(new URL(request.url))) }),
  );
}
