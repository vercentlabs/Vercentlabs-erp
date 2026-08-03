import { publishLeadForm, saveLeadForm } from "@vercentlabs/api";
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
    requirePermissionFromSession(session, PERMISSIONS.crmCaptureManage);
    const context = crmContext(session);
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
