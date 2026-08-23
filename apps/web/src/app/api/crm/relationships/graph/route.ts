import { getRelationshipGraph } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsManage);
    const partyId = new URL(request.url).searchParams.get("partyId");
    if (!partyId) throw new HttpError(400, "Account is required.");
    const context = await crmApiContext(session);
    const relationships = await tenantTransaction(
      context.organizationId,
      (client) => getRelationshipGraph(client, context, partyId),
    );
    return ok({ relationships });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const message =
        "message" in error ? String(error.message) : "CRM request failed.";
      return errorResponse(new HttpError(Number(error.status), message));
    }
    return errorResponse(error);
  }
}
