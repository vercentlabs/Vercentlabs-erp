import { getLeadScoreExplanation, recalculateLeadScore } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const { id } = await params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        getLeadScoreExplanation(client, context, id),
      ),
    );
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const reason = String(input.reason || "Manual recalculation").trim().slice(0, 500) || "Manual recalculation";
    const context = await crmApiContext(session);

    const result = await tenantTransaction(context.organizationId, async (client) => {
      const score = await recalculateLeadScore(client, context, id, reason);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.score_recalculated",
        entityType: "lead",
        entityId: id,
        afterData: score,
        request,
        client,
      });
      return score;
    });

    return ok({ message: "Lead score recalculated.", ...result });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
