import { analyzeAccountImport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/accounts/server/account-http";

// Import step 1: read the file and suggest the column mapping.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsImport }, async ({ client, session }) => {
    const upload = await readUpload(request);
    return ok({ analysis: await analyzeAccountImport(client, crmContext(session), { bytes: upload.bytes, fileName: upload.fileName }) });
  });
}
