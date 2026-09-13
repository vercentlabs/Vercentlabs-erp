import {
  getCrmLeadAcquisitionReadiness,
  getLeadAcquisitionDashboard,
} from "@vercentlabs/api";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    // Sequential, not Promise.all — see the CRM revenue-intelligence fix for
    // why concurrent client.query() on one shared PoolClient is unsafe.
    const [dashboard, readiness] = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const dashboardResult = await getLeadAcquisitionDashboard(client, context);
        const readinessResult = await getCrmLeadAcquisitionReadiness(client, context);
        return [dashboardResult, readinessResult] as const;
      },
    );
    return mobileOk(request, {
      dashboard,
      readiness,
      contractVersion: "crm-lead-acquisition-v1",
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
