import { assertSameOriginOrMobile, createSalesStage, listSalesStages } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F012 Sales Stages — the dedicated governed module (sales-stage-
// operations.js), not the generic /api/crm/[resource] boundary, which
// already redirects "stages" mutations here (CRM_SALES_STAGE_API_MOVED).
// Pipelines themselves (the parent of a stage) ARE a plain generic
// CRM_RESOURCE_KEYS resource with no such redirect — reuse
// /api/crm/pipelines for pipeline CRUD, this only covers stages.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId");
    if (!pipelineId) throw new HttpError(400, "A pipeline is required.");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listSalesStages(client, crmContext(session), { pipelineId, status: "all" });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return createSalesStage(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
