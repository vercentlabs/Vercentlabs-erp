import { BACKGROUND_IMPORT_ROW_LIMIT, analyzeLeadImport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/leads/server/lead-http";

// Import step 1 (a file too large to import at once is read up to the background limit): read the file and suggest a column mapping. Nothing is stored.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsImport }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    const upload = await readUpload(request);
    return ok({ analysis: await analyzeLeadImport(client, context, { bytes: upload.bytes, fileName: upload.fileName, maxRows: BACKGROUND_IMPORT_ROW_LIMIT }) });
  });
}
