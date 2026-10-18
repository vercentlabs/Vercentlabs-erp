import { BACKGROUND_IMPORT_ROW_LIMIT, analyzeOpportunityImport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/leads/server/lead-http";

// Deal import step 1 (a file too large to import at once is read up to the background limit): read the file and suggest a column
// mapping. Nothing is stored.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesImport }, async ({ client, session, snapshot }) => {
    const upload = await readUpload(request);
    return ok({ analysis: await analyzeOpportunityImport(client, crmContext(session, snapshot), { bytes: upload.bytes, fileName: upload.fileName, maxRows: BACKGROUND_IMPORT_ROW_LIMIT }) });
  });
}
