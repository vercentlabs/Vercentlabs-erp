import {
  commitLeadImport,
  previewLeadImport,
  rollbackLeadImport,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/server/lead-acquisition";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmImport);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const action = String(input.action || "preview");
    const result = await tenantTransaction(context.organizationId, (client) => {
      if (action === "commit")
        return commitLeadImport(client, context, String(input.batchId || ""));
      if (action === "rollback")
        return rollbackLeadImport(client, context, String(input.batchId || ""));
      return previewLeadImport(client, context, input);
    });
    return ok({ result }, action === "preview" ? 201 : 200);
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
