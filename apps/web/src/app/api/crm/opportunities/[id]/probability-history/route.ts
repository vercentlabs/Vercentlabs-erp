import { listOpportunityProbabilityHistory } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F011 gap-closure — crm_opportunity_probability_history has been an
// immutable, provenance-tagged ledger since migration 066/099 with zero
// readers anywhere in the product until now.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listOpportunityProbabilityHistory(client, crmContext(session), id);
    return ok({ rows });
  });
}
