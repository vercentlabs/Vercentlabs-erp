import { getAccountReport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { accountFiltersFromUrl } from "@/features/crm/accounts/server/account-http";

// Accounts grouped by owner, type, status, industry, source, team or month.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session, snapshot }) =>
    ok({ report: await getAccountReport(client, crmContext(session, snapshot), accountFiltersFromUrl(new URL(request.url))) }),
  );
}
