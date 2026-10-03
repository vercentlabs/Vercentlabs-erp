import { analyzeLeadImport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/leads/server/lead-http";

// Import step 1: read the file and suggest a column mapping. Nothing is stored.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsImport }, async ({ client, session }) => {
    const context = crmContext(session);
    const upload = await readUpload(request);
    return ok({ analysis: await analyzeLeadImport(client, context, upload) });
  });
}
