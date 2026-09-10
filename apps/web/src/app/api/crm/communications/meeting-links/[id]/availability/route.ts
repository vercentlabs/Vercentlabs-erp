import { getMeetingAvailability } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/seller-activity-and-follow-up-workspace/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function GET(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const date = new URL(request.url).searchParams.get("date") || "";
    const slots = await tenantTransaction(context.organizationId, (client) =>
      getMeetingAvailability(client, context, id, date),
    );
    return ok({ slots });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
