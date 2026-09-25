import { assertSameOriginOrMobile, getLeadAssignmentFallback, setLeadAssignmentFallback } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F005 gap-closure — getLeadAssignmentFallback/setLeadAssignmentFallback
// (assignment/availability.js) already existed and are already the row
// the live assignment engine reads last, after every policy has had its
// chance; there was previously no route or screen to configure it, so an
// admin's only option was writing SQL directly against the tenant DB.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return getLeadAssignmentFallback(client, crmContext(session));
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { userId?: string | null };
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage, { mutation: true });
      return setLeadAssignmentFallback(client, crmContext(session), body.userId ?? null);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
