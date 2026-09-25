import { listStageSlaPolicies } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Gated the same as PipelineStagesSettingsScreen itself (crm.settings.manage)
// — this is configuration data for that screen, not something an ordinary
// rep needs to see directly (the board's bottleneck badges already surface
// the effective outcome without exposing the policy knobs).
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId");
    if (!pipelineId) throw new HttpError(400, "pipelineId is required.");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return listStageSlaPolicies(client, crmContext(session), pipelineId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
