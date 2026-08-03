import {
  getCrmLeadIntelligenceReadiness,
  getLeadIntelligenceDashboard,
} from "@vercentlabs/api";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
    const [dashboard, readiness] = await tenantTransaction(
      context.organizationId,
      async (client) =>
        Promise.all([
          getLeadIntelligenceDashboard(client, context),
          getCrmLeadIntelligenceReadiness(client, context),
        ]),
    );
    return mobileOk(request, {
      dashboard,
      readiness,
      contractVersion: "crm-lead-intelligence-v1",
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
