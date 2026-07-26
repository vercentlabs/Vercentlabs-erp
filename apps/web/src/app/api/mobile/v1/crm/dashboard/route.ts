import { getCrmDashboard } from "@vercentlabs/api";
import { requireCrmView } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requireCrmView(session);
    const context = crmContext(session);
    const dashboard = await tenantTransaction(context.organizationId, (client) =>
      getCrmDashboard(client, context),
    );
    return mobileOk(request, { dashboard });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); }
  }
}
