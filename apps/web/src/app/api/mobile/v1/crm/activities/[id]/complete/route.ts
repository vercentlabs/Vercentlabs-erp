import { completeCrmActivity } from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { completeActivitySchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { audit } from "@/core/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = completeActivitySchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, async (client) => withMobileIdempotency(client, session, request, input, async () => {
      const record = await completeCrmActivity(client, context, id, input.outcome, { expectedUpdatedAt: input.expectedUpdatedAt, expectedStatus: input.expectedStatus });
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.activity.completed", entityType: "activity", entityId: id, afterData: record, request, client });
      return { message: "Activity completed.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
