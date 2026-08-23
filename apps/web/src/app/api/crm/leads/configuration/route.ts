import { getLeadConfiguration } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmResourceView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmResourceView(session, "leads");
    const key =
      new URL(request.url).searchParams.get("recordType") || "standard";
    const context = await crmApiContext(session);
    return ok(
      await tenantTransaction(context.organizationId, (c) =>
        getLeadConfiguration(c, context, key),
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
