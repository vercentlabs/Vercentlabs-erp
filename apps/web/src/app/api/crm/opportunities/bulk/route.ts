import { bulkAssignOpportunities, bulkChangeOpportunityStage } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// Bulk operations on selected opportunities. Body: { action, opportunityIds, ... }
//   assign  { ownerUserId?, teamId?, reason? } — needs crm.opportunities.reassign
//   stage   { stageId } — open stages only
// Each opportunity succeeds or fails on its own; the response lists every outcome.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { action, ...input } = await readBody(request);
    const payload = input as { opportunityIds: string[] } & Record<string, unknown>;
    if (action === "assign") return ok(await bulkAssignOpportunities(client, context, payload));
    if (action === "stage") return ok(await bulkChangeOpportunityStage(client, context, payload));
    throw new HttpError(400, "Unknown bulk action.");
  });
}
