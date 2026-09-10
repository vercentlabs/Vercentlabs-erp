import { completeCrmFollowUp, getCrmFollowUp } from "@vercentlabs/api";
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
import { followUpLifecycleSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";

// Mobile/API parity (F016) — Follow-up completion goes through its OWN
// dedicated completeCrmFollowUp (not the generic activities/[id]/complete
// mobile already has), so this route was a real gap until now, not just a
// UX one.
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = followUpLifecycleSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const before = await getCrmFollowUp(client, context, id);
        const completed = await completeCrmFollowUp(client, context, id, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.follow_up.completed",
          entityType: "follow_up",
          entityId: id,
          beforeData: crmFollowUpAuditSnapshot(before),
          afterData: crmFollowUpAuditSnapshot(completed),
          request,
          client,
        });
        return { message: "Follow-up completed.", record: completed };
      }),
    );
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
