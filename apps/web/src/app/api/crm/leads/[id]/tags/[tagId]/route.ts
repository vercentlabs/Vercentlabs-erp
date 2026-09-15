import { assertSameOriginOrMobile, removeRecordTag } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; tagId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id, tagId } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return removeRecordTag(client, crmContext(session), "lead", id, tagId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
