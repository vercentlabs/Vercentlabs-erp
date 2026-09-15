import { assertSameOriginOrMobile, deleteCrmAttachment } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function DELETE(request: Request, context: { params: Promise<{ entityType: string; entityId: string; id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { entityType, entityId, id } = await context.params;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return deleteCrmAttachment(client, crmContext(session), entityType as never, entityId, id);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
