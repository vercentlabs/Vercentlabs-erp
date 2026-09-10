import {
  getSalesStage,
  setSalesStageActive,
  updateSalesStage,
  enqueueOpportunityStageMigrationJob,
  CrmError,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

type Route = { params: Promise<{ id: string }> };

export async function GET(_request: Request, route: Route) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    return ok({ record: await tenantTransaction(context.organizationId, (client) => getSalesStage(client, context, id)) });
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
    const context = await crmApiContext(session);
    let migrationJob = null;
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getSalesStage(client, context, id);
      let updated;
      if (action === "deactivate" || action === "reactivate") {
        const migrateToStageId = String(input.migrateToStageId || "").trim();
        try {
          updated = await setSalesStageActive(client, context, id, action === "reactivate", String(input.expectedUpdatedAt || ""));
        } catch (error) {
          // A deactivation blocked by open Opportunities, with a replacement
          // stage nominated, becomes a governed background migration instead
          // of a hard failure — mirrors F007's safe stage deactivation. The
          // stage itself is deactivated once the job clears every open
          // Opportunity off it (the caller retries this same action then).
          if (
            action === "deactivate" &&
            migrateToStageId &&
            error instanceof CrmError &&
            error.code === "CRM_SALES_STAGE_OPEN_OPPORTUNITIES"
          ) {
            migrationJob = await enqueueOpportunityStageMigrationJob(client, context, id, migrateToStageId);
            return before;
          }
          throw error;
        }
      } else if (action === "update") {
        const payload = { ...input };
        delete payload.action;
        updated = await updateSalesStage(client, context, id, payload);
      } else throw new HttpError(400, "Unsupported sales-stage action.");
      if (!updated.replayed)
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: `crm.sales_stage.${action === "update" ? "updated" : action === "deactivate" ? "deactivated" : "reactivated"}`,
          entityType: "sales_stage",
          entityId: id,
          beforeData: { pipelineId: before.pipelineId, name: before.name, stageType: before.stageType, probability: before.probability, status: before.status, sequence: before.sequence },
          afterData: { pipelineId: updated.pipelineId, name: updated.name, stageType: updated.stageType, probability: updated.probability, status: updated.status, sequence: updated.sequence },
          request,
          client,
        });
      return updated;
    });
    return ok({
      message: migrationJob
        ? "Migration started. The stage will deactivate once every open Opportunity has moved."
        : record.replayed
          ? "Sales stage is already in the requested state."
          : action === "deactivate"
            ? "Sales stage deactivated."
            : action === "reactivate"
              ? "Sales stage reactivated."
              : "Sales stage updated.",
      record,
      migrationJob,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
