import {
  capturePredictiveForecast,
  cloneOpportunity,
  getCrmOpportunityRevenueReadiness,
  getOpportunityRevenueDashboard,
  getOpportunityRevenueWorkspace,
  saveMutualActionPlan,
  saveOpportunityRecurringRevenue,
  saveOpportunityRevenueSplits,
  saveQuotaSeasonality,
  submitWinLossReview,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmOpportunityRevenueErrorResponse } from "@/lib/crm-opportunity-revenue-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const opportunityId = new URL(request.url).searchParams.get(
      "opportunityId",
    );
    const data = await tenantTransaction(
      context.organizationId,
      async (client) => ({
        dashboard: await getOpportunityRevenueDashboard(client, context),
        readiness: await getCrmOpportunityRevenueReadiness(client, context),
        workspace: opportunityId
          ? await getOpportunityRevenueWorkspace(client, context, opportunityId)
          : null,
      }),
    );
    return ok(data);
  } catch (error) {
    return crmOpportunityRevenueErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "");
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "save-recurring-revenue")
          return saveOpportunityRecurringRevenue(client, context, input);
        if (action === "save-revenue-splits")
          return saveOpportunityRevenueSplits(client, context, input);
        if (action === "save-action-plan")
          return saveMutualActionPlan(client, context, input);
        if (
          action === "clone-opportunity" &&
          typeof input.opportunityId === "string"
        )
          return cloneOpportunity(client, context, input.opportunityId, input);
        if (action === "submit-win-loss")
          return submitWinLossReview(client, context, input);
        if (action === "capture-predictive-forecast")
          return capturePredictiveForecast(client, context, input);
        if (action === "save-quota-seasonality")
          return saveQuotaSeasonality(client, context, input);
        throw new HttpError(400, "Unsupported opportunity-revenue action.");
      },
    );
    return ok(result);
  } catch (error) {
    return crmOpportunityRevenueErrorResponse(error);
  }
}
