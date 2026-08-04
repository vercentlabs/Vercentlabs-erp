import { getCrmAiDashboard } from "@vercentlabs/api";
import { requireMobileSession } from "@/lib/mobile-session";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export async function GET(request: Request) {
  try {
    const s = await requireMobileSession(request);
    requirePermissionFromSession(s, PERMISSIONS.crmView);
    const c = crmContext(s);
    return mobileOk(request, {
      dashboard: await tenantTransaction(c.organizationId, (client) =>
        getCrmAiDashboard(client, c),
      ),
    });
  } catch (e) {
    return mobileError(request, e);
  }
}
