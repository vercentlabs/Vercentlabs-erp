import { assertSameOriginOrMobile, removeLeadStageTransition } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ fromId: string; toId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { fromId, toId } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage, { mutation: true });
      return removeLeadStageTransition(client, crmContext(session), fromId, toId);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
