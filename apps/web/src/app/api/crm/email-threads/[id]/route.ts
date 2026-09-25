import { getCrmEmailThread } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F018 gap-closure — listThreadMessages (the conversation view) had no
// route; it enforces shared-inbox membership and per-message projection.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmEmailThread(client, crmContext(session), id);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
