import { transitionLeadStage } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const status = String(input.status || "");
    const expectedUpdatedAt = String(input.expectedUpdatedAt || "").trim();
    if (!expectedUpdatedAt)
      throw new HttpError(
        400,
        "Refresh this Lead before moving it.",
        "CRM_LEAD_VERSION_REQUIRED",
      );
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const transition = await transitionLeadStage(client, context, id, {
        stageCode: status,
        expectedUpdatedAt,
        requireVersion: true,
        source: input.source || "legacy",
      });
      if (transition.changed) await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
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
    return ok({
      message: record.changed ? `Lead moved to ${record.stage.name}.` : "Lead is already in that stage.",
      record: record.record,
      stage: record.stage,
      changed: record.changed,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
