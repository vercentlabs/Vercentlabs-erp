import { getSessionContext } from "@/core/auth";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError } from "@/core/http";
import { releaseGovernanceContext } from "@/core/release";

export async function releaseGovernanceSession(write = false) {
  const session = await getSessionContext();
  if (!session?.organizationId) {
    throw new HttpError(401, "Sign in to an organisation workspace.");
  }
  if (write) {
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
  }
  return { session, context: releaseGovernanceContext(session) };
}

export { tenantTransaction };
