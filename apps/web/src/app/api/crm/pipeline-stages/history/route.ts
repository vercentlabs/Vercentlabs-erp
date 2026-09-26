import { listSalesStageHistory } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F012 gap-closure — tenant.crm_sales_stage_configuration_history has
// recorded every created/updated/reordered/deactivated/reactivated action
// with before/after snapshots since it shipped, but listSalesStageHistory
// had zero callers anywhere in apps/web. Gated the same as the Pipeline
// Stages settings screen itself (crm.settings.manage) — this is
// configuration audit data, not something an ordinary rep needs.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) => {
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId");
    if (!pipelineId) throw new HttpError(400, "pipelineId is required.");
    const limit = url.searchParams.get("limit");
    const rows = await listSalesStageHistory(client, crmContext(session), pipelineId, limit ? Number(limit) : undefined);
    return ok({ rows });
  });
}
