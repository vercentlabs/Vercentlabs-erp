import { createLeadStageTransitionReason, listLeadStageTransitionReasons } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const context = await crmApiContext(session);
    return ok({ records: await tenantTransaction(context.organizationId, (client) => listLeadStageTransitionReasons(client, context)) });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createLeadStageTransitionReason(client, context, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.lead_stage_transition_reason.created",
        entityType: "lead_stage_transition_reason",
        entityId: String(created.id),
        afterData: created,
        request,
        client,
      });
      return created;
    });
    return ok({ message: "Reason created.", record }, 201);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
