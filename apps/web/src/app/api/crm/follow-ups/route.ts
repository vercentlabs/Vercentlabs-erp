import { assertSameOriginOrMobile, createCrmFollowUp, listCrmFollowUps } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F016 Follow-ups & reminders. crm_activities with activity_type=
// 'follow_up' — follow-up-operations.js is the ONE governed lifecycle
// authority (multi-reminder scheduling, business-hours-aware delivery,
// escalation). Matches Tasks/Calls/Meetings: no internal baseline
// permission check, so this route enforces crm.activities.manage.
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
    const result = await withClient(async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listCrmFollowUps(client, crmContext(session), filters);
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
      return createCrmFollowUp(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
