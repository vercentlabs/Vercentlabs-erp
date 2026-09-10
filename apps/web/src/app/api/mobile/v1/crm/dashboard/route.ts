import { getCrmDashboard } from "@vercentlabs/api";
import { requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requireCrmView(session);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(context.organizationId, (client) =>
      getCrmDashboard(client, context),
    );
    return mobileOk(request, { dashboard });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); }
  }
}
