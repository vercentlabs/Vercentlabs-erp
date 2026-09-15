import { assertSameOriginOrMobile, setSalesStageActive } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { active?: boolean; expectedUpdatedAt?: string };
    if (!body.expectedUpdatedAt) throw new HttpError(400, "Refresh the stage and submit its current version.");
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return setSalesStageActive(client, crmContext(session), id, Boolean(body.active), body.expectedUpdatedAt as string);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
