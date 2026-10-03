import { findLeadDuplicates } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Duplicate check while typing a lead. Body: the lead fields, and
// excludeLeadId when editing an existing lead. Nothing is stored.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) => {
    const context = crmContext(session);
    const { excludeLeadId, ...input } = await readBody(request);
    return ok(await findLeadDuplicates(client, context, input, { excludeLeadId: typeof excludeLeadId === "string" ? excludeLeadId : null }));
  });
}
