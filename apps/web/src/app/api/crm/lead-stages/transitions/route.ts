import { addLeadStageTransition, listLeadStageTransitions, removeLeadStageTransition } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { requireCrmView } from "@/modules/crm/api";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const context = await crmApiContext(session);
    return ok({ records: await tenantTransaction(context.organizationId, (client) => listLeadStageTransitions(client, context)) });
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
    const input = (await readJson(request)) as { fromStageId?: string; toStageId?: string; reasonRequired?: boolean };
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const created = await addLeadStageTransition(client, context, String(input.fromStageId || ""), String(input.toStageId || ""), {
        reasonRequired: input.reasonRequired === true,
      });
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.lead_stage_transition.added",
        entityType: "lead_stage_transition",
        entityId: `${created.fromStageId}:${created.toStageId}`,
        afterData: created,
        request,
        client,
      });
      return created;
    });
    return ok({ message: "Transition added.", record }, 201);
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    await requireBillingWriteAccess(session.organizationId);
    const url = new URL(request.url);
    const fromStageId = url.searchParams.get("from") || "";
    const toStageId = url.searchParams.get("to") || "";
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      await removeLeadStageTransition(client, context, fromStageId, toStageId);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.lead_stage_transition.removed",
        entityType: "lead_stage_transition",
        entityId: `${fromStageId}:${toStageId}`,
        beforeData: { fromStageId, toStageId },
        request,
        client,
      });
    });
    return ok({ message: "Transition removed." });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
