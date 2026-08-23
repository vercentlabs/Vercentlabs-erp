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
    const [dashboard, readiness] = await tenantTransaction(
      context.organizationId,
      async (client) =>
        Promise.all([
          getLeadAcquisitionDashboard(client, context),
          getCrmLeadAcquisitionReadiness(client, context),
        ]),
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
