import { getCrmReport } from "@vercent/api";
import { getSessionContext } from "@/lib/auth";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
export async function GET(
  request: Request,
  route: { params: Promise<{ report: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmReportsView);
    const { report } = await route.params;
    const url = new URL(request.url);
    const context = crmContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      getCrmReport(
        client,
        context,
        report,
        Object.fromEntries(url.searchParams.entries()),
      ),
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
