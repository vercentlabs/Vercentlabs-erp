import {
  ingestCalendarDelta,
  ingestMailboxDelta,
  synchronizeProviderAccount,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/server/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmIntegrationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const syncAccountId = String(input.syncAccountId || "");
    const result = await tenantTransaction(context.organizationId, (client) => {
      if (input.executeProvider === true) {
        return synchronizeProviderAccount(
          client,
          context,
          syncAccountId,
          input,
        );
      }
      return input.syncType === "calendar"
        ? ingestCalendarDelta(client, context, syncAccountId, input)
        : ingestMailboxDelta(client, context, syncAccountId, input);
    });
    return ok({ result });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
