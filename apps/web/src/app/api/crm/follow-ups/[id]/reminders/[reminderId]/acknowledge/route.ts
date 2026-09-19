import { acknowledgeReminder, assertSameOriginOrMobile } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function POST(request: Request, context: { params: Promise<{ id: string; reminderId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, reminderId } = await context.params;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage, { mutation: true });
      return acknowledgeReminder(client, crmContext(session), id, reminderId);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
