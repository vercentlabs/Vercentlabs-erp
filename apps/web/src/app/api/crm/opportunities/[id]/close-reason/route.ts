import { correctOpportunityCloseReason } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Corrects the reason of a closed opportunity. Body: { reasonId, notes?, competitorName?, correctionReason }
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEditCloseReason, billingWrite: true }, async ({ client, session }) => {
    const body = await readBody(request);
    return ok(await correctOpportunityCloseReason(client, crmContext(session), (await route.params).id, {
      reasonId: String(body.reasonId ?? ""), correctionReason: String(body.correctionReason ?? ""),
      ...(body.notes === undefined ? {} : { notes: String(body.notes ?? "") }),
      ...(body.competitorName === undefined ? {} : { competitorName: String(body.competitorName ?? "") }),
    }));
  });
}
