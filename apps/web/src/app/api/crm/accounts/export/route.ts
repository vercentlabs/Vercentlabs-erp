import { exportAccounts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { accountFiltersFromUrl, csvResponse } from "@/features/crm/accounts/server/account-http";

// Downloads the accounts the list shows for the same view and filters.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsExport }, async ({ client, session }) => {
    const exported = await exportAccounts(client, crmContext(session), accountFiltersFromUrl(new URL(request.url)));
    return csvResponse(exported.csv, exported.fileName);
  });
}
