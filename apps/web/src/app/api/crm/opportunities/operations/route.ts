import {
  bulkUpdateOpportunities,
  captureForecastSnapshot,
  getOpportunityDashboard,
  getOpportunityTimeline,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requireCrmManage } from "@/lib/crm-api";
import { crmApiContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "opportunities");
    const context = await crmApiContext(session);
    const id = new URL(request.url).searchParams.get("id");
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        id
          ? getOpportunityTimeline(client, context, id)
          : getOpportunityDashboard(client, context),
      ),
    );
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "opportunities");
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "bulk-update"
        ? bulkUpdateOpportunities(client, context, input)
        : input.action === "capture-forecast" && typeof input.id === "string"
          ? captureForecastSnapshot(client, context, input.id)
          : Promise.reject(
              new HttpError(400, "Unsupported opportunity operation."),
            ),
    );
    return ok(result);
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
