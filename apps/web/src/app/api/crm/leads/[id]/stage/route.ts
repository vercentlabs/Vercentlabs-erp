import { getLeadStageDwell, listLeadStageHistory, transitionLeadStage } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

type Route = { params: Promise<{ id: string }> };

export async function GET(_request: Request, route: Route) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const { history, dwell } = await tenantTransaction(context.organizationId, async (client) => ({
      history: await listLeadStageHistory(client, context, id),
      dwell: await getLeadStageDwell(client, context, id),
    }));
    return ok({ history, dwell });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request, route: Route) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const expectedUpdatedAt = String(input.expectedUpdatedAt || "").trim();
    if (!expectedUpdatedAt)
      throw new HttpError(
        400,
        "Refresh this Lead before moving it.",
        "CRM_LEAD_VERSION_REQUIRED",
      );
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => {
      const transition = await transitionLeadStage(client, context, id, {
        ...input,
        expectedUpdatedAt,
        requireVersion: true,
      });
      if (transition.changed)
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.lead.stage_changed",
          entityType: "lead",
          entityId: id,
          beforeData: { status: transition.event.fromStageCode },
          afterData: { status: transition.event.toStageCode, eventId: transition.event.id },
          request,
          client,
        });
      return transition;
    });
    return ok({ message: result.changed ? `Lead moved to ${result.stage.name}.` : "Lead is already in that stage.", ...result });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
