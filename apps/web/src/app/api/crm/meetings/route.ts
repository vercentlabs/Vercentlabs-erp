import { assertSameOriginOrMobile, createCrmMeeting, listCrmMeetings } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F014 Meetings. crm_activities with activity_type='meeting' —
// meeting-operations.js is the ONE governed lifecycle authority; create
// supports both "schedule" (future meeting) and "log" (retroactively
// record one that already happened) modes, matching Calls' convention.
// meeting-operations.js does not check a permission internally, so this
// route enforces crm.activities.manage itself (matching Tasks/Calls).
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const filters = {
      status: url.searchParams.get("status") || undefined,
      due: url.searchParams.get("due") || undefined,
      search: url.searchParams.get("search") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listCrmMeetings(client, crmContext(session), filters);
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
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return createCrmMeeting(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
