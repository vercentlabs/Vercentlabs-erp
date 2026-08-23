import { queueLeadEnrichment, reviewLeadEnrichment } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/server/lead-acquisition";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmDataQualityManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "review"
        ? reviewLeadEnrichment(
            client,
            context,
            String(input.reviewId || ""),
            input,
          )
        : queueLeadEnrichment(client, context, input),
    );
    return ok({ result }, input.action === "review" ? 200 : 201);
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
