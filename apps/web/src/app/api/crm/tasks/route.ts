import { assertSameOriginOrMobile, createCrmTask, listCrmTasks } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F015 Tasks. crm_activities with activity_type='task' — task-operations.js
// is the ONE governed lifecycle authority (claim/release/dependencies/
// recurrence), never duplicated here. Its own comments document that base
// access ("crm.activities.manage") is expected to be enforced at the
// route level, not inside the domain function — this route is that
// enforcement point.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const filters = {
      status: url.searchParams.get("status") || undefined,
      due: url.searchParams.get("due") || undefined,
      mine: url.searchParams.get("mine") === "true" || undefined,
      teamId: url.searchParams.get("teamId") || undefined,
      queueOnly: url.searchParams.get("queueOnly") === "true" || undefined,
      search: url.searchParams.get("search") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listCrmTasks(client, crmContext(session), filters);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage, { mutation: true });
      return createCrmTask(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
