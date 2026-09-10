import { deactivateLeadStageWithMigration, getLeadStage, reactivateLeadStage, updateLeadStage } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
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
    const input = (await readJson(request)) as Record<string, unknown> & { migrateToStageId?: string };
    const action = String(input.action || "update");
    delete input.action;
    const migrateToStageId = typeof input.migrateToStageId === "string" ? input.migrateToStageId : undefined;
    delete input.migrateToStageId;
    const context = await crmApiContext(session);
    const outcome = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getLeadStage(client, context, id);
      if (action === "deactivate") {
        const result = await deactivateLeadStageWithMigration(client, context, id, { migrateToStageId });
        if (!result.deactivated) return { record: result.stage, migrationJob: result.migrationJob };
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.lead_stage.deactivated",
          entityType: "lead_stage",
          entityId: id,
          beforeData: { code: before.code, name: before.name, status: before.status, sortOrder: before.sortOrder },
          afterData: { code: result.stage.code, name: result.stage.name, status: result.stage.status, sortOrder: result.stage.sortOrder },
          request,
          client,
        });
        return { record: result.stage };
      }
      const updated = action === "reactivate"
        ? await reactivateLeadStage(client, context, id)
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
      return { record: updated };
    });
    if (outcome.migrationJob) {
      return ok({
        message: `${outcome.migrationJob.resultManifest?.requested ?? 0} active Lead(s) are migrating to the replacement stage before this stage can be deactivated.`,
        record: outcome.record,
        migrationJob: outcome.migrationJob,
      });
    }
    return ok({
      message: action === "deactivate" ? "Stage deactivated." : action === "reactivate" ? "Stage reactivated." : "Stage updated.",
      record: outcome.record,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
