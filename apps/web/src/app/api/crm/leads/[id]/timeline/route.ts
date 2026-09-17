import { getCrmRecordTimelinePage } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F019 activity timeline for a single lead — combines stage/assignment/
// qualification/calls/meetings/tasks/follow-ups/notes/communications
// events; permission projection is getCrmRecordTimelinePage's own
// authority (services/api/src/modules/crm/seller-activity-and-follow-up-
// workspace/timeline/timeline.js).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const page = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmRecordTimelinePage(client, crmContext(session), "lead", id, { cursor: cursor ?? undefined, limit });
    });
    return ok({ page });
  } catch (error) {
    return errorResponse(error);
  }
}
