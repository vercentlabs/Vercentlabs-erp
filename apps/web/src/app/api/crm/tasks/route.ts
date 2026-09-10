import { createCrmTask, listCrmTasks } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { crmTaskAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";

// F015 Tasks workspace closeout — a dedicated route (mirroring calls/
// meetings/follow-ups) rather than riding the generic [resource] route,
// per the dossier's explicit "do not use a generic resource manager."
// listCrmTasks/createCrmTask already carry the real team/queue filtering
// and validation; no separate zod schema is layered on top (task-
// operations.js's own normalize()/assertAllowed() is the real validation).
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
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
    return ok(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const input = (await readJson(request)) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
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
      return created;
    });
    return ok({ message: "Task created.", record }, 201);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
