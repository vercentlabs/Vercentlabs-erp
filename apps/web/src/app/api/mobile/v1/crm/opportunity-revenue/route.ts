import {
  getCrmOpportunityRevenueReadiness,
  getOpportunityRevenueDashboard,
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
    // Sequential, not Promise.all — both functions issue several
    // client.query() calls each on one shared PoolClient; see
    // opportunity-revenue-intelligence.js's own fix for why concurrent
    // client.query() on a single client is unsafe (pg 08P01 protocol
    // violation, reproduced live).
    const [dashboard, readiness] = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const dashboardResult = await getOpportunityRevenueDashboard(client, context);
        const readinessResult = await getCrmOpportunityRevenueReadiness(client, context);
        return [dashboardResult, readinessResult] as const;
      },
    );
    return mobileOk(request, {
      dashboard,
      readiness,
      contractVersion: "crm-opportunity-revenue-v1",
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
