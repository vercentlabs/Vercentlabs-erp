import { getCommunicationsDashboard } from "@vercentlabs/api";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";

// F018/mobile-parity fix — this route previously authenticated via
// getSessionContext() (the WEB cookie-session helper) instead of
// requireMobileSession(request) (the Bearer-token session every other
// mobile/v1/crm route uses) — a real inconsistency: a mobile client
// presenting only its access token, no browser cookie, would have failed
// here with a misleading 401 rather than the real Bearer-session check.
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getCommunicationsDashboard(client, context),
    );
    return mobileOk(request, { dashboard, contractVersion: "crm-communications-v1" });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
