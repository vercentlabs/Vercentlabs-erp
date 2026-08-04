import { queueLeadEnrichment, reviewLeadEnrichment } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmLeadAcquisitionErrorResponse } from "@/lib/crm-lead-acquisition-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmDataQualityManage);
    const context = crmContext(session);
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
