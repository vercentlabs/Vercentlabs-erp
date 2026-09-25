import { getOpportunityPredictiveProbability } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F011 gap-closure — the predictive-forecast model already computes a real
// per-Opportunity predicted probability on every snapshot capture, but it
// was buried inside the org-wide crm_predictive_forecast_snapshots row with
// no accessor pulling one Opportunity's own entry back out. Returns null
// (not a 404) when no snapshot has ever included this Opportunity yet — an
// absent prediction, not an error.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const prediction = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getOpportunityPredictiveProbability(client, crmContext(session), id);
    });
    return ok({ prediction });
  } catch (error) {
    return errorResponse(error);
  }
}
