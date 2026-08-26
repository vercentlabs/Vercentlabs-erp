import { listEligibleLeadAssignees } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import {
  hasPermission,
  PERMISSIONS,
  requirePermissionFromSession,
} from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    const url = new URL(request.url);
    const purpose = url.searchParams.get("purpose") || "assignment";
    if (purpose === "rule") {
      requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    } else {
      requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
      if (
        !hasPermission(session, PERMISSIONS.crmRecordsViewAll) &&
        !session.roleSlugs.includes("organization_owner")
      )
        throw new HttpError(403, "You do not have permission to assign Leads.");
    }
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      listEligibleLeadAssignees(client, context, {
        search: String(url.searchParams.get("search") || "").slice(0, 120),
        limit: Math.min(50, Number(url.searchParams.get("limit")) || 20),
        offset: Math.max(0, Number(url.searchParams.get("offset")) || 0),
      }),
    );
    return ok(result);
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
