import { getSessionContext } from "@/lib/auth";
import { listBillingPlans } from "@/lib/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { errorResponse, HttpError, ok } from "@/lib/http";

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
