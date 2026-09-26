import { createCrmFollowUp, listCrmFollowUps } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F016 Follow-ups & reminders. crm_activities with activity_type=
// 'follow_up' — follow-up-operations.js is the ONE governed lifecycle
// authority (multi-reminder scheduling, business-hours-aware delivery,
// escalation). Matches Tasks/Calls/Meetings: no internal baseline
// permission check, so this route enforces crm.activities.manage.
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
    const result = await listCrmFollowUps(client, crmContext(session), filters);
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createCrmFollowUp(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
