import { getCustomFieldValueHistory } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F028 — custom field change history for one record. Authorization is the
// same parent-record access as reading the values (resolveCrmEntityAccess).
export async function GET(_request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { entityType, entityId } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCustomFieldValueHistory(client, crmContext(session), entityType as never, entityId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
