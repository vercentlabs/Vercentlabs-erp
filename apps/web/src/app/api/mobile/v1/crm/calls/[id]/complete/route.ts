import { completeCrmCall, getCrmCall } from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { audit } from "@/core/security";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmCallAuditSnapshot } from "@/modules/crm/audit";
import { completeCallSchema } from "@/modules/crm/validation";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request); requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!); const { id } = await route.params; assertCrmIdentifier(id);
    const input = completeCallSchema.parse(await readJson(request)); await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) => withMobileIdempotency(client, session, request, input, async () => {
      const before = await getCrmCall(client, context, id); const record = await completeCrmCall(client, context, id, input);
      if (!record.replayed) await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.call.completed", entityType: "call", entityId: id, beforeData: crmCallAuditSnapshot(before), afterData: crmCallAuditSnapshot(record), request, client });
      return { message: record.replayed ? "Call is already completed with this outcome." : "Call completed.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
