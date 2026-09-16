import { getCrmDashboard } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F024. Every KPI's formula/scope/permission-safe aggregation is
// getCrmDashboard's own authority (services/api/src/modules/crm/
// pipeline-analytics-and-forecasting/analytics-service.js) — this route
// never computes or shapes a metric itself.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const dashboard = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmDashboard(client, crmContext(session));
    });
    return ok({ dashboard });
  } catch (error) {
    return errorResponse(error);
  }
}
