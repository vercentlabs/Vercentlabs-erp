import { getLeadStageMigrationJob } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmSettingsManage);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, (client) => getLeadStageMigrationJob(client, context, id));
    if (!record) throw new HttpError(404, "Migration job not found.");
    return ok({ record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
