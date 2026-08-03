import {
  commitLeadImport,
  previewLeadImport,
  rollbackLeadImport,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmLeadAcquisitionErrorResponse } from "@/lib/crm-lead-acquisition-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmImport);
    const context = crmContext(session);
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
