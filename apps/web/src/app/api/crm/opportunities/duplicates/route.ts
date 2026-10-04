import { findDuplicateOpportunities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// Open opportunities on the same account that look like this one. Body: { accountId, name?, productInterest?, excludeId? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) => {
    const { excludeId, ...input } = await readBody(request);
    return ok(await findDuplicateOpportunities(client, crmContext(session), input, { excludeId: typeof excludeId === "string" ? excludeId : null }));
  });
}
