import { getSessionContext, type WorkspaceSessionContext } from "@/core/auth";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError } from "@/core/http";
import { assertModuleAccessible } from "@/core/module-access";
import { stockContext } from "@/modules/stock";
export async function stockSession(write = false) {
  const session = await getSessionContext();
  if (!session?.organizationId)
    throw new HttpError(401, "Sign in to an organisation workspace.");
  await assertModuleAccessible(session as WorkspaceSessionContext, "stock");
  if (write) {
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
  }
  return { session, context: stockContext(session) };
}
export { tenantTransaction };
