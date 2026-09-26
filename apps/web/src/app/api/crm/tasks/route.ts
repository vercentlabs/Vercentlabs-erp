import { createCrmTask, listCrmTasks } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F015 Tasks. crm_activities with activity_type='task' — task-operations.js
// is the ONE governed lifecycle authority (claim/release/dependencies/
// recurrence), never duplicated here. Its own comments document that base
// access ("crm.activities.manage") is expected to be enforced at the
// route level, not inside the domain function — this route is that
// enforcement point.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const url = new URL(request.url);
    const filters = {
      status: url.searchParams.get("status") || undefined,
      due: url.searchParams.get("due") || undefined,
      mine: url.searchParams.get("mine") === "true" || undefined,
      myTeam: url.searchParams.get("myTeam") === "true" || undefined,
      teamId: url.searchParams.get("teamId") || undefined,
      queueOnly: url.searchParams.get("queueOnly") === "true" || undefined,
      search: url.searchParams.get("search") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await listCrmTasks(client, crmContext(session), filters);
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createCrmTask(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
