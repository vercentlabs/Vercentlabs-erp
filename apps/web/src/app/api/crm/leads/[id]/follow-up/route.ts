import {
  createCrmCall,
  createCrmMeeting,
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
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { scheduleLeadFollowUpSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
import { crmCallAuditSnapshot, crmMeetingAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");

    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
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

        const activity = input.activityType === "call"
          ? await createCrmCall(client, context, {
              mode: "schedule",
              companyId: before.companyId || null,
              branchId: before.branchId || null,
              entityType: "lead",
              entityId: id,
              subject: input.subject,
              description: input.description || null,
              priority: input.priority,
              assignedTo: input.assignedTo || before.ownerUserId || context.userId,
              dueAt: input.dueAt,
              direction: "outbound",
            })
          : input.activityType === "meeting"
            ? await createCrmMeeting(client, context, {
                mode: "schedule",
                companyId: before.companyId || null,
                branchId: before.branchId || null,
                entityType: "lead",
                entityId: id,
                subject: input.subject,
                description: input.description || null,
                priority: input.priority,
                assignedTo: input.assignedTo || before.ownerUserId || context.userId,
                startAt: input.dueAt,
                endAt: new Date(Date.parse(input.dueAt) + 30 * 60_000).toISOString(),
                locationType: "other",
              })
            : await createCrmRecord(client, context, "activities", {
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
          eventType: input.activityType === "call" ? "crm.call.scheduled" : input.activityType === "meeting" ? "crm.meeting.scheduled" : "crm.activities.created",
          entityType: input.activityType === "call" ? "call" : input.activityType === "meeting" ? "meeting" : "activities",
          entityId: String(activity.id),
          afterData: input.activityType === "call" ? crmCallAuditSnapshot(activity) : input.activityType === "meeting" ? crmMeetingAuditSnapshot(activity) : activity,
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
