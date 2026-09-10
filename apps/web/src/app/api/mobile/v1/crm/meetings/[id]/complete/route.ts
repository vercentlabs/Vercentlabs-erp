import { getCrmMeeting, completeCrmMeeting } from "@vercentlabs/api";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { audit } from "@/core/security";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmMeetingAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";
import { completeMeetingSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request); requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!); const { id } = await route.params; assertCrmIdentifier(id);
    const input = completeMeetingSchema.parse(await readJson(request)); await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) => withMobileIdempotency(client, session, request, input, async () => {
      const before = await getCrmMeeting(client, context, id); const record = await completeCrmMeeting(client, context, id, input);
      if (!record.replayed) await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.meeting.completed", entityType: "meeting", entityId: id, beforeData: crmMeetingAuditSnapshot(before), afterData: crmMeetingAuditSnapshot(record), request, client });
      return { message: record.replayed ? "Meeting is already completed with this outcome." : "Meeting completed.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
