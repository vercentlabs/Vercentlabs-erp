import {
  refreshMarketingSegment,
  saveMarketingSegment,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmMarketingErrorResponse } from "@/lib/crm-marketing-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCampaignsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "refresh"
        ? refreshMarketingSegment(
            client,
            context,
            String(input.segmentId || ""),
          )
        : saveMarketingSegment(client, context, input),
    );
    return ok({ result }, input.action === "refresh" ? 200 : 201);
  } catch (error) {
    return crmMarketingErrorResponse(error);
  }
}
