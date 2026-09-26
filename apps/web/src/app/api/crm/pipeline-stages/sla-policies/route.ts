import { listStageSlaPolicies } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Gated the same as PipelineStagesSettingsScreen itself (crm.settings.manage)
// — this is configuration data for that screen, not something an ordinary
// rep needs to see directly (the board's bottleneck badges already surface
// the effective outcome without exposing the policy knobs).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) => {
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId");
    if (!pipelineId) throw new HttpError(400, "pipelineId is required.");
    const rows = await listStageSlaPolicies(client, crmContext(session), pipelineId);
    return ok({ rows });
  });
}
