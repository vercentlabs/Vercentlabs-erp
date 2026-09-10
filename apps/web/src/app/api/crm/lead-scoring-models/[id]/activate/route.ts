import { activateLeadScoringModel } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
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
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => {
      const outcome = await activateLeadScoringModel(client, context, id);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.lead_scoring_model.activated",
        entityType: "lead_scoring_model",
        entityId: id,
        afterData: { model: outcome.model, recalcJobId: outcome.recalcJob?.id ?? null },
        request,
        client,
      });
      return outcome;
    });
    return ok({
      message: result.recalcJob
        ? `Model activated. Recalculating ${result.recalcJob.resultManifest?.requested ?? 0} Lead(s) in the background.`
        : "Model activated.",
      record: result.model,
      recalcJob: result.recalcJob,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
