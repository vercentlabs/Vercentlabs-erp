import { listEmailSignatures, upsertEmailSignature } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
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
    const context = crmContext(session);
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
