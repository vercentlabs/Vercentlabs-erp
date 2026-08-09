import { findContactDuplicates } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsManage);
    const input = Object.fromEntries(
      new URL(request.url).searchParams.entries(),
    );
    const context = await crmApiContext(session);
    const duplicates = await tenantTransaction(
      context.organizationId,
      (client) => findContactDuplicates(client, context, input),
    );
    return ok({ duplicates });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      const message =
        "message" in error ? String(error.message) : "CRM request failed.";
      return errorResponse(new HttpError(Number(error.status), message));
    }
    return errorResponse(error);
  }
}
