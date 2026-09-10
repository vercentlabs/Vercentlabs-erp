import { listAccountContactRelationships } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const relationships = await tenantTransaction(context.organizationId, (client) =>
      listAccountContactRelationships(client, context, id),
    );
    return ok({ relationships });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
