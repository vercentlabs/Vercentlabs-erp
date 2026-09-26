import { getOpportunityPredictiveProbability } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F011 gap-closure — the predictive-forecast model already computes a real
// per-Opportunity predicted probability on every snapshot capture, but it
// was buried inside the org-wide crm_predictive_forecast_snapshots row with
// no accessor pulling one Opportunity's own entry back out. Returns null
// (not a 404) when no snapshot has ever included this Opportunity yet — an
// absent prediction, not an error.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const prediction = await getOpportunityPredictiveProbability(client, crmContext(session), id);
    return ok({ prediction });
  });
}
