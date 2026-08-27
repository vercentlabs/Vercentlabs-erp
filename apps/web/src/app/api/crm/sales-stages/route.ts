import {
  createSalesStage,
  listSalesStagePipelines,
  listSalesStages,
  reorderSalesStages,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    const context = await crmApiContext(session);
    const requestedPipelineId = String(new URL(request.url).searchParams.get("pipelineId") || "").trim();
    const result = await tenantTransaction(context.organizationId, async (client) => {
      const pipelines = await listSalesStagePipelines(client, context, { status: "all" });
      const selected = pipelines.find((pipeline) => String(pipeline.id) === requestedPipelineId) || pipelines[0] || null;
      const stages = selected
        ? await listSalesStages(client, context, { pipelineId: String(selected.id), status: "all" })
        : { rows: [], total: 0 };
      return { pipelines, selectedPipelineId: selected ? String(selected.id) : null, stages: stages.rows };
    });
    return ok(result);
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
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "create");
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => {
      if (action === "reorder") {
        const reordered = await reorderSalesStages(
          client,
          context,
          String(input.pipelineId || ""),
          Array.isArray(input.entries) ? input.entries as Array<{ id: string; expectedUpdatedAt: string }> : [],
        );
        if (reordered.changed)
          await audit({
            organizationId: context.organizationId,
            actorUserId: context.userId,
            eventType: "crm.sales_stages.reordered",
            entityType: "sales_pipeline",
            entityId: String(input.pipelineId || ""),
            afterData: { stageIds: reordered.rows.filter((row) => row.status === "active").map((row) => row.id) },
            request,
            client,
          });
        return { message: reordered.changed ? "Sales stages reordered." : "Sales stage order is already current.", ...reordered };
      }
      if (action !== "create") throw new HttpError(400, "Unsupported sales-stage action.");
      const payload = { ...input };
      delete payload.action;
      const created = await createSalesStage(client, context, payload);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.sales_stage.created",
        entityType: "sales_stage",
        entityId: String(created.id),
        afterData: { id: created.id, pipelineId: created.pipelineId, code: created.code, name: created.name, stageType: created.stageType, probability: created.probability, status: created.status },
        request,
        client,
      });
      return { message: "Sales stage created.", record: created };
    });
    return ok(result, action === "create" ? 201 : 200);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
