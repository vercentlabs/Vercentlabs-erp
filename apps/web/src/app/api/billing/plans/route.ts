import { getSessionContext } from "@/core/auth";
import { listBillingPlans } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { errorResponse, HttpError, ok } from "@/core/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.billingView);
    return ok({ plans: await listBillingPlans() });
  } catch (error) {
    return errorResponse(error);
  }
}
