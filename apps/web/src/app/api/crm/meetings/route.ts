import { createCrmMeeting, listCrmMeetings } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F014 Meetings. crm_activities with activity_type='meeting' —
// meeting-operations.js is the ONE governed lifecycle authority; create
// supports both "schedule" (future meeting) and "log" (retroactively
// record one that already happened) modes, matching Calls' convention.
// meeting-operations.js does not check a permission internally, so this
// route enforces crm.activities.manage itself (matching Tasks/Calls).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const url = new URL(request.url);
    const filters = {
      status: url.searchParams.get("status") || undefined,
      due: url.searchParams.get("due") || undefined,
      search: url.searchParams.get("search") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await listCrmMeetings(client, crmContext(session), filters);
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createCrmMeeting(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
