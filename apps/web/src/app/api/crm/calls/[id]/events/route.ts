import { listCrmCallEvents } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F013 gap-closure — listCrmCallEvents (the immutable crm_call_events
// lifecycle ledger reader) existed, tested and exported at the top-level
// @vercentlabs/api package since call-operations.js was first written, but
// had zero routes or frontend callers anywhere in apps/web.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const rows = await listCrmCallEvents(client, crmContext(session), id, limit ? Number(limit) : undefined);
    return ok({ rows });
  });
}
