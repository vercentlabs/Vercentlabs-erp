import { crmCoreAcceptanceContext } from "@vercentlabs/api";

import { getSessionContext } from "@/lib/auth";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/lib/billing";
import { tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";

export async function crmCoreAcceptanceSession(write = false) {
  const session = await getSessionContext();
  if (!session?.organizationId) {
    throw new HttpError(401, "Sign in to an organisation workspace.");
  }
  if (write) {
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
  }
  return { session, context: crmCoreAcceptanceContext(session) };
}

export { tenantTransaction };
