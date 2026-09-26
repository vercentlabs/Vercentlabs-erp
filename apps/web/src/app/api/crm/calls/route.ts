import { createCrmCall, listCrmCalls } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F013 Calls. crm_activities with activity_type='call' — call-operations.js
// is the ONE governed lifecycle authority; create supports both "schedule"
// (future call) and "log" (retroactively record a call that already
// happened) modes, both handled entirely server-side. Matches Tasks'
// documented convention: base access (crm.activities.manage) is enforced
// at the route level, not inside the domain function.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const url = new URL(request.url);
    const filters = {
      status: url.searchParams.get("status") || undefined,
      direction: url.searchParams.get("direction") || undefined,
      due: url.searchParams.get("due") || undefined,
      search: url.searchParams.get("search") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await listCrmCalls(client, crmContext(session), filters);
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createCrmCall(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
