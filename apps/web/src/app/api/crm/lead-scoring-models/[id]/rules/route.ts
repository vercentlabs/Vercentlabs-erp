import { createLeadScoringModelRule } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createLeadScoringModelRule(client, context, id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.lead_scoring_model_rule.created",
        entityType: "lead_scoring_model_rule",
        entityId: String(created.id),
        afterData: created,
        request,
        client,
      });
      return created;
    });
    return ok({ message: "Rule created.", record }, 201);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
