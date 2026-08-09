import {
  createSharedInbox,
  getCommunicationsDashboard,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getCommunicationsDashboard(client, context),
    );
    return ok({ inboxes: dashboard.inboxes, threads: dashboard.threads });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmIntegrationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const inbox = await tenantTransaction(context.organizationId, (client) =>
      createSharedInbox(client, context, input),
    );
    return ok({ inbox }, 201);
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
