import { createCrmTask, listCrmTasks } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { crmTaskAuditSnapshot } from "@/modules/crm/audit";

// Mobile/API parity closeout (F015) — mobile reuses the SAME
// listCrmTasks/createCrmTask domain functions the dedicated web Tasks
// routes call (apps/web/src/app/api/crm/tasks/route.ts), not the generic
// [resource] route and not a re-derived mobile-only query — same team/
// queue filtering, same validation, same claim/dependency/recurrence
// domain rules apply identically to a mobile caller.
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const params = new URL(request.url).searchParams;
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmTasks(client, context, {
        search: params.get("search") || "",
        status: params.get("status") || "all",
        due: params.get("due") || "all",
        limit: params.get("limit") || 25,
        offset: params.get("offset") || 0,
        mine: params.get("mine") === "true",
        teamId: params.get("teamId") || undefined,
        queueOnly: params.get("queueOnly") === "true",
      }),
    );
    return mobileOk(request, result);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const input = (await readJson(request)) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const created = await createCrmTask(client, context, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.task.created",
          entityType: "task",
          entityId: String(created.id),
          afterData: crmTaskAuditSnapshot(created),
          request,
          client,
        });
        return { message: "Task created.", record: created };
      }),
    );
    return mobileOk(request, response, 201);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
