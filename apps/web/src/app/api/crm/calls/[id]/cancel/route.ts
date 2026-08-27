import { cancelCrmCall, getCrmCall } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmCallAuditSnapshot } from "@/modules/crm/audit";
import { callLifecycleSchema } from "@/modules/crm/validation";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = callLifecycleSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmCall(client, context, id);
      const cancelled = await cancelCrmCall(client, context, id, input);
      if (!cancelled.replayed) await audit({ organizationId: context.organizationId, actorUserId: context.userId, eventType: "crm.call.cancelled", entityType: "call", entityId: id, beforeData: crmCallAuditSnapshot(before), afterData: crmCallAuditSnapshot(cancelled), request, client });
      return cancelled;
    });
    return ok({ message: record.replayed ? "Call is already cancelled." : "Call cancelled.", record });
  } catch (error) { return crmErrorResponse(error); }
}
