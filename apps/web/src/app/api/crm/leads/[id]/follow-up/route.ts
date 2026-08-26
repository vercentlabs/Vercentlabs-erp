import {
  createCrmRecord,
  getCrmRecord,
  updateCrmRecord,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { scheduleLeadFollowUpSchema } from "@/modules/crm/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");

    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);

    const { id } = await params;
    assertCrmIdentifier(id);
    const input = scheduleLeadFollowUpSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);

    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const before = await getCrmRecord(client, context, "leads", id);
        if (["converted", "archived"].includes(String(before.recordStatus))) {
          throw new HttpError(
            409,
            "Follow-ups cannot be scheduled for converted or archived leads.",
            "CRM_LEAD_FOLLOW_UP_CLOSED",
          );
        }

        const activity = await createCrmRecord(client, context, "activities", {
          companyId: before.companyId || null,
          branchId: before.branchId || null,
          entityType: "lead",
          entityId: id,
          activityType: input.activityType,
          subject: input.subject,
          description: input.description || null,
          status: "planned",
          priority: input.priority,
          assignedTo: input.assignedTo || before.ownerUserId || context.userId,
          dueAt: input.dueAt,
        });

        const lead = await updateCrmRecord(client, context, "leads", id, {
          nextFollowUpAt: input.dueAt,
        });

        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.activities.created",
          entityType: "activities",
          entityId: String(activity.id),
          afterData: activity,
          request,
          client,
        });
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.lead.followup.scheduled",
          entityType: "lead",
          entityId: id,
          afterData: {
            activityId: activity.id,
            dueAt: input.dueAt,
            activityType: input.activityType,
          },
          request,
          client,
        });

        return { activity, lead };
      },
    );

    return ok({
      message: "Follow-up scheduled and lead next-follow-up updated.",
      ...result,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
