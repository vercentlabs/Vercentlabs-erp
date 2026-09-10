import { publishLeadForm, saveLeadForm } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/prospect-and-relationship-master-data/lead-acquisition";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCaptureManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "publish"
        ? publishLeadForm(client, context, String(input.formId || ""))
        : saveLeadForm(client, context, input),
    );
    return ok({ result }, input.action === "publish" ? 200 : 201);
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
