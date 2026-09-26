import { createSalesStage, listSalesStages } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F012 Sales Stages — the dedicated governed module (sales-stage-
// operations.js), not the generic /api/crm/[resource] boundary, which
// already redirects "stages" mutations here (CRM_SALES_STAGE_API_MOVED).
// Pipelines themselves (the parent of a stage) ARE a plain generic
// CRM_RESOURCE_KEYS resource with no such redirect — reuse
// /api/crm/pipelines for pipeline CRUD, this only covers stages.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId");
    if (!pipelineId) throw new HttpError(400, "A pipeline is required.");
    const result = await listSalesStages(client, crmContext(session), { pipelineId, status: "all" });
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createSalesStage(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
