import { listCrmMeetingEvents } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F014 gap-closure — listCrmMeetingEvents (the immutable crm_meeting_events
// lifecycle ledger reader) existed, tested and exported at the top-level
// @vercentlabs/api package, but had zero routes or frontend callers.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const rows = await listCrmMeetingEvents(client, crmContext(session), id, limit ? Number(limit) : undefined);
    return ok({ rows });
  });
}
