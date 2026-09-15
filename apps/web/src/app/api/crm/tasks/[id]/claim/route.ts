import { assertSameOriginOrMobile, claimCrmTask } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return claimCrmTask(client, crmContext(session), id, input);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
