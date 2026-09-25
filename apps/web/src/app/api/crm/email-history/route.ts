import { getCrmEmailHistory } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F018 gap-closure — getCommunicationTimeline (thread, assignee, first-
// response SLA and open/click engagement per email) had no route or UI.
// getCrmEmailHistory adds the parent-record gate the raw reader lacks for
// Opportunity/Account/Contact and applies per-row content projection.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType") ?? "";
    const entityId = url.searchParams.get("entityId") ?? "";
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmEmailHistory(client, crmContext(session), entityType, entityId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
