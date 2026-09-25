import { listCrmCallEvents } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F013 gap-closure — listCrmCallEvents (the immutable crm_call_events
// lifecycle ledger reader) existed, tested and exported at the top-level
// @vercentlabs/api package since call-operations.js was first written, but
// had zero routes or frontend callers anywhere in apps/web.
export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listCrmCallEvents(client, crmContext(session), id, limit ? Number(limit) : undefined);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
