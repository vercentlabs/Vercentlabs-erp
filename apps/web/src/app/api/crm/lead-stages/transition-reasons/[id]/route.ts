import { setLeadStageTransitionReasonActive } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as { active?: boolean };
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const updated = await setLeadStageTransitionReasonActive(client, context, id, input.active !== false);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.lead_stage_transition_reason.updated",
        entityType: "lead_stage_transition_reason",
        entityId: id,
        afterData: updated,
        request,
        client,
      });
      return updated;
    });
    return ok({ message: "Reason updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
