import { getCrmEmailHistory } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F018 gap-closure — getCommunicationTimeline (thread, assignee, first-
// response SLA and open/click engagement per email) had no route or UI.
// getCrmEmailHistory adds the parent-record gate the raw reader lacks for
// Opportunity/Account/Contact and applies per-row content projection.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType") ?? "";
    const entityId = url.searchParams.get("entityId") ?? "";
    const rows = await getCrmEmailHistory(client, crmContext(session), entityType, entityId);
    return ok({ rows });
  });
}
