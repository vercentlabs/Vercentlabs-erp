import { createLeadAcquisitionConnection } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/prospect-and-relationship-master-data/lead-acquisition";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmIntegrationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const connection = await tenantTransaction(
      context.organizationId,
      (client) => createLeadAcquisitionConnection(client, context, input),
    );
    return ok({ connection }, 201);
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
