import { listEmailSignatures, upsertEmailSignature } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/server/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const signatures = await tenantTransaction(
      context.organizationId,
      (client) => listEmailSignatures(client, context),
    );
    return ok({ signatures });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const signature = await tenantTransaction(
      context.organizationId,
      (client) => upsertEmailSignature(client, context, input),
    );
    return ok({ signature }, 201);
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
