import { getSessionContext } from "@/lib/auth";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/lib/billing";
import { tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { releaseGovernanceContext } from "@/lib/release-governance";

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
