import { completeCrmActivity } from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { assertCrmIdentifier } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { completeActivitySchema } from "@/lib/crm-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { withMobileIdempotency } from "@/lib/mobile-idempotency";
import { audit } from "@/lib/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = completeActivitySchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = crmContext(session);
    const response = await tenantTransaction(context.organizationId, async (client) => withMobileIdempotency(client, session, request, input, async () => {
      const record = await completeCrmActivity(client, context, id, input.outcome, { expectedUpdatedAt: input.expectedUpdatedAt, expectedStatus: input.expectedStatus });
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.activity.completed", entityType: "activity", entityId: id, afterData: record, request, client });
      return { message: "Activity completed.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
