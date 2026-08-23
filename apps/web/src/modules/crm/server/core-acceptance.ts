import { crmCoreAcceptanceContext } from "@vercentlabs/api";

import { getSessionContext, type WorkspaceSessionContext } from "@/core/auth";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError } from "@/core/http";
import { assertModuleAccessible } from "@/core/module-access";

export async function crmCoreAcceptanceSession(write = false) {
  const session = await getSessionContext();
  if (!session?.organizationId) {
    throw new HttpError(401, "Sign in to an organisation workspace.");
  }
  await assertModuleAccessible(session as WorkspaceSessionContext, "crm");
  if (write) {
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
  }
  return { session, context: crmCoreAcceptanceContext(session) };
}

export { tenantTransaction };
