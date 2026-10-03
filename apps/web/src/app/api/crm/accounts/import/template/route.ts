import { buildAccountImportTemplate } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { csvResponse } from "@/features/crm/accounts/server/account-http";

// The downloadable import template: every importable column and one sample row.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsImport }, async () =>
    csvResponse(buildAccountImportTemplate(), "account-import-template.csv"),
  );
}
