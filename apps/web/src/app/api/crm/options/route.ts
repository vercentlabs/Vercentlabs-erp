import { getCrmOptions } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requireCrmView } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const context = crmContext(session);
    const options = await tenantTransaction(context.organizationId, (client) =>
      getCrmOptions(client, context),
    );
    return ok({ options });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
