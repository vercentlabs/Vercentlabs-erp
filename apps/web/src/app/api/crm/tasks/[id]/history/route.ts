import { listCrmTaskHistory } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await params; assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    return ok({ rows: await tenantTransaction(context.organizationId, (client) => listCrmTaskHistory(client, context, id)) });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); } }
}
