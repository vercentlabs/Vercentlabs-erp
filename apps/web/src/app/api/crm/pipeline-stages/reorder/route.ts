import { assertSameOriginOrMobile, reorderSalesStages } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { pipelineId?: string; entries?: Array<{ id: string; expectedUpdatedAt: string }> };
    if (!body.pipelineId) throw new HttpError(400, "A pipeline is required.");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return reorderSalesStages(client, crmContext(session), body.pipelineId as string, body.entries ?? []);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
