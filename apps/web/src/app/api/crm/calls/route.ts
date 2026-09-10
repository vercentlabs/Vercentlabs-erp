import { createCrmCall, listCrmCalls } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { crmCallAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";
import { createCallSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const params = new URL(request.url).searchParams;
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmCalls(client, context, {
        search: params.get("search") || "",
        status: params.get("status") || "all",
        direction: params.get("direction") || "all",
        due: params.get("due") || "all",
        limit: params.get("limit") || 25,
        offset: params.get("offset") || 0,
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
    const input = createCallSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createCrmCall(client, context, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: input.mode === "log" ? "crm.call.logged" : "crm.call.scheduled",
        entityType: "call",
        entityId: String(created.id),
        afterData: crmCallAuditSnapshot(created),
        request,
        client,
      });
      return created;
    });
    return ok({ message: input.mode === "log" ? "Call logged." : "Call scheduled.", record }, 201);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
