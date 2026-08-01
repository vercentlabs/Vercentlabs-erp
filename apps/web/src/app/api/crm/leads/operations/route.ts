import {
  bulkUpdateLeads,
  getLeadOperationsDashboard,
  previewLeadAssignment,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requireCrmManage } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "leads");
    const context = crmContext(session);
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
    const context = crmContext(session);
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
