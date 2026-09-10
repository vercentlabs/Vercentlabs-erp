import { getCrmFollowUp, listRemindersForActivity, updateCrmFollowUp } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { crmFollowUpAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";
import { updateFollowUpSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";

type Route = { params: Promise<{ id: string }> };

export async function GET(request: Request, route: Route) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params; assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => ({
      record: await getCrmFollowUp(client, context, id),
      reminders: await listRemindersForActivity(client, context, id),
    }));
    return mobileOk(request, result);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function PATCH(request: Request, route: Route) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = updateFollowUpSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const before = await getCrmFollowUp(client, context, id);
        const updated = await updateCrmFollowUp(client, context, id, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.follow_up.updated",
          entityType: "follow_up",
          entityId: id,
          beforeData: crmFollowUpAuditSnapshot(before),
          afterData: crmFollowUpAuditSnapshot(updated),
          request,
          client,
        });
        return { message: "Follow-up updated.", record: updated };
      }),
    );
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
