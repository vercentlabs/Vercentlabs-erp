import { createCrmCall } from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { audit } from "@/core/security";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { crmCallAuditSnapshot } from "@/modules/crm/audit";
import { createCallSchema } from "@/modules/crm/validation";

export async function POST(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const input = createCallSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const record = await createCrmCall(client, context, input);
        await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: input.mode === "log" ? "crm.call.logged" : "crm.call.scheduled", entityType: "call", entityId: String(record.id), afterData: crmCallAuditSnapshot(record), request, client });
        return { message: input.mode === "log" ? "Call logged." : "Call scheduled.", record };
      }),
    );
    return mobileOk(request, response, 201);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
