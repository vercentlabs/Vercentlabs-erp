import { getLeadAttributionTimeline } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Read-only multi-touch attribution timeline for one Lead (see
// lead-attribution.js). getLeadAttributionTimeline already scopes to what
// this caller may see via leadScopeSql (company/branch/owner) — this route
// only enforces the module-access layer, same as leads/[id]/score.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const model = url.searchParams.get("model") || undefined;
    const timeline = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getLeadAttributionTimeline(client, crmContext(session), id, { model });
    });
    return ok({ timeline });
  } catch (error) {
    return errorResponse(error);
  }
}
