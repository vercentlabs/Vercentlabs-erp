import { getSessionContext, type WorkspaceSessionContext } from "@/lib/auth";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/lib/billing";
import { tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { assertModuleAccessible } from "@/lib/module-access";
import { accountingContext } from "@/lib/accounting";

export async function accountingSession(write = false) {
  const session = await getSessionContext();
  if (!session?.organizationId) throw new HttpError(401, "Sign in to an organisation workspace.");
  await assertModuleAccessible(session as WorkspaceSessionContext, "accounting");
  if (write) {
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
  }
  return { session, context: accountingContext(session) };
}
export { tenantTransaction };
