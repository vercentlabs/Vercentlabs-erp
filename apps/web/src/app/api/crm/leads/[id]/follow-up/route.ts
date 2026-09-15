import { z } from "zod";

import {
  assertSameOriginOrMobile,
  audit,
  createCrmCall,
  createCrmMeeting,
  createCrmRecord,
  getCrmRecord,
  requireSessionPermission,
  updateCrmRecord,
} from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";
import { crmCallAuditSnapshot, crmMeetingAuditSnapshot } from "@/features/crm/shared/audit-events";

const scheduleLeadFollowUpSchema = z.object({
  activityType: z.enum(["call", "meeting", "task", "email", "whatsapp", "sms", "note"]),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  assignedTo: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime(),
});

// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// app/api/crm/leads/[id]/follow-up/route.ts (F016). Schedules a call/
// meeting/generic activity against the lead AND advances the lead's own
// nextFollowUpAt in the same transaction — a converted/archived lead
// rejects new follow-ups outright.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    requireSessionPermission(session, CRM_PERMISSIONS.leadsManage);
    requireSessionPermission(session, CRM_PERMISSIONS.leadsViewSensitive);
    requireSessionPermission(session, CRM_PERMISSIONS.activitiesManage);

    const { id } = await context.params;
    const input = scheduleLeadFollowUpSchema.parse(await readJson(request));
    const crmApiContext = crmContext(session);

    const result = await tenantTransaction(session.organizationId, async (client) => {
      const before = await getCrmRecord(client, crmApiContext, "leads", id);
      if (["converted", "archived"].includes(String(before.recordStatus))) {
        throw new HttpError(409, "Follow-ups cannot be scheduled for converted or archived leads.", "CRM_LEAD_FOLLOW_UP_CLOSED");
      }

      const activity =
        input.activityType === "call"
          ? await createCrmCall(client, crmApiContext, {
              mode: "schedule",
              companyId: before.companyId || null,
              branchId: before.branchId || null,
              entityType: "lead",
              entityId: id,
              subject: input.subject,
              description: input.description || null,
              priority: input.priority,
              assignedTo: input.assignedTo || before.ownerUserId || session.userId,
              dueAt: input.dueAt,
              direction: "outbound",
            })
          : input.activityType === "meeting"
            ? await createCrmMeeting(client, crmApiContext, {
                mode: "schedule",
                companyId: before.companyId || null,
                branchId: before.branchId || null,
                entityType: "lead",
                entityId: id,
                subject: input.subject,
                description: input.description || null,
                priority: input.priority,
                assignedTo: input.assignedTo || before.ownerUserId || session.userId,
                startAt: input.dueAt,
                endAt: new Date(Date.parse(input.dueAt) + 30 * 60_000).toISOString(),
                locationType: "other",
              })
            : await createCrmRecord(client, crmApiContext, "activities", {
                companyId: before.companyId || null,
                branchId: before.branchId || null,
                entityType: "lead",
                entityId: id,
                activityType: input.activityType,
                subject: input.subject,
                description: input.description || null,
                status: "planned",
                priority: input.priority,
                assignedTo: input.assignedTo || before.ownerUserId || session.userId,
                dueAt: input.dueAt,
              });

      const lead = await updateCrmRecord(client, crmApiContext, "leads", id, { nextFollowUpAt: input.dueAt });

      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType:
          input.activityType === "call" ? "crm.call.scheduled" : input.activityType === "meeting" ? "crm.meeting.scheduled" : "crm.activities.created",
        entityType: input.activityType === "call" ? "call" : input.activityType === "meeting" ? "meeting" : "activities",
        entityId: String(activity.id),
        afterData:
          input.activityType === "call" ? crmCallAuditSnapshot(activity) : input.activityType === "meeting" ? crmMeetingAuditSnapshot(activity) : activity,
        request,
        env: process.env,
      });
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.followup.scheduled",
        entityType: "lead",
        entityId: id,
        afterData: { activityId: activity.id, dueAt: input.dueAt, activityType: input.activityType },
        request,
        env: process.env,
      });

      return { activity, lead };
    });

    return ok({ message: "Follow-up scheduled and lead next-follow-up updated.", ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
