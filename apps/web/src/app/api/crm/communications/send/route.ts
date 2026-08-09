import { queueOutboundEmail } from "@vercentlabs/api";

import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

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
