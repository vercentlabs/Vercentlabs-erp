import { setLeadScoringModelRuleStatus } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

export async function PATCH(request: Request, route: { params: Promise<{ id: string; ruleId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id, ruleId } = await route.params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(ruleId);
    const input = (await readJson(request)) as { status?: string };
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const updated = await setLeadScoringModelRuleStatus(client, context, id, ruleId, input.status === "inactive" ? "inactive" : "active");
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.lead_scoring_model_rule.updated",
        entityType: "lead_scoring_model_rule",
        entityId: ruleId,
        afterData: updated,
        request,
        client,
      });
      return updated;
    });
    return ok({ message: "Rule updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
