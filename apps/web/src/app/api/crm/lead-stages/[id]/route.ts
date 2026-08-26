import { getLeadStage, setLeadStageActive, updateLeadStage } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";

type Route = { params: Promise<{ id: string }> };

export async function GET(_request: Request, route: Route) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    return ok({ record: await tenantTransaction(context.organizationId, (client) => getLeadStage(client, context, id)) });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function PATCH(request: Request, route: Route) {
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
    const action = String(input.action || "update");
    delete input.action;
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getLeadStage(client, context, id);
      const updated = action === "deactivate"
        ? await setLeadStageActive(client, context, id, false)
        : action === "reactivate"
          ? await setLeadStageActive(client, context, id, true)
          : await updateLeadStage(client, context, id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: `crm.lead_stage.${action === "update" ? "updated" : `${action}d`}`,
        entityType: "lead_stage",
        entityId: id,
        beforeData: { code: before.code, name: before.name, status: before.status, sortOrder: before.sortOrder },
        afterData: { code: updated.code, name: updated.name, status: updated.status, sortOrder: updated.sortOrder },
        request,
        client,
      });
      return updated;
    });
    return ok({ message: action === "deactivate" ? "Stage deactivated; existing Leads keep it." : action === "reactivate" ? "Stage reactivated." : "Stage updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
