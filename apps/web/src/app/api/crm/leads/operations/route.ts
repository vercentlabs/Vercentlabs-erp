import {
  bulkUpdateLeads,
  getLeadOperationsDashboard,
  previewLeadAssignment,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmManage } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "leads");
    const context = await crmApiContext(session);
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        getLeadOperationsDashboard(client, context),
      ),
    );
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "leads");
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) =>
        input.action === "preview-assignment"
          ? previewLeadAssignment(client, context, input.lead || {})
          : input.action === "bulk-update"
            ? bulkUpdateLeads(client, context, input)
            : Promise.reject(new HttpError(400, "Unsupported lead operation.")),
    );
    return ok(result);
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
