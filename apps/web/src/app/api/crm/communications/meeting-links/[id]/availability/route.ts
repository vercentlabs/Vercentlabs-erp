import { getMeetingAvailability } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function GET(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
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
