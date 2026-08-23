import { getCommunicationTimeline } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/server/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const url = new URL(request.url);
    const input = Object.fromEntries(
      ["leadId", "opportunityId", "partyId", "contactId"]
        .map((key) => [key, url.searchParams.get(key)])
        .filter(([, value]) => value),
    );
    const timeline = await tenantTransaction(context.organizationId, (client) =>
      getCommunicationTimeline(client, context, input),
    );
    return ok({ timeline });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
