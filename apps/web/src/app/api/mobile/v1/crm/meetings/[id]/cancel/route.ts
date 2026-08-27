import { getCrmMeeting, cancelCrmMeeting } from "@vercentlabs/api";
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
import { crmMeetingAuditSnapshot } from "@/modules/crm/audit";
import { meetingLifecycleSchema } from "@/modules/crm/validation";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request); requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!); const { id } = await route.params; assertCrmIdentifier(id);
    const input = meetingLifecycleSchema.parse(await readJson(request)); await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) => withMobileIdempotency(client, session, request, input, async () => {
      const before = await getCrmMeeting(client, context, id); const record = await cancelCrmMeeting(client, context, id, input);
      if (!record.replayed) await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.meeting.cancelled", entityType: "meeting", entityId: id, beforeData: crmMeetingAuditSnapshot(before), afterData: crmMeetingAuditSnapshot(record), request, client });
      return { message: record.replayed ? "Meeting is already cancelled." : "Meeting cancelled.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
