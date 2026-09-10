import { getCrmTask, listCrmTaskHistory, updateCrmTask } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { crmTaskAuditSnapshot } from "@/modules/crm/audit";

type Route = { params: Promise<{ id: string }> };

// Mobile/API parity (F015) — same getCrmTask/listCrmTaskHistory/
// updateCrmTask domain functions web's dedicated Tasks route uses;
// recurrence config, dependency ids and blocked-status all come through
// on the record exactly as they do for web (no mobile-only trimmed shape).
export async function GET(request: Request, route: Route) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params; assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => ({
      record: await getCrmTask(client, context, id),
      events: await listCrmTaskHistory(client, context, id),
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
    const input = (await readJson(request)) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const before = await getCrmTask(client, context, id);
        const updated = await updateCrmTask(client, context, id, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.task.updated",
          entityType: "task",
          entityId: id,
          beforeData: crmTaskAuditSnapshot(before),
          afterData: crmTaskAuditSnapshot(updated),
          request,
          client,
        });
        return { message: "Task updated.", record: updated };
      }),
    );
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
