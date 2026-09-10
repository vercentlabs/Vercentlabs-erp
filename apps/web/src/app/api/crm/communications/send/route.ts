import { queueOutboundEmail } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/seller-activity-and-follow-up-workspace/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const message = await tenantTransaction(context.organizationId, (client) =>
      queueOutboundEmail(client, context, input),
    );
    return ok({ message }, 202);
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
