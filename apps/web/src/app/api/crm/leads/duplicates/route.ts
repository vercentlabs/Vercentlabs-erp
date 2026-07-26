import { findCrmDuplicates } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requireCrmView } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { duplicateSchema } from "@/lib/crm-validation";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const url = new URL(request.url);
    const input = duplicateSchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    const context = crmContext(session);
    const duplicates = await tenantTransaction(
      context.organizationId,
      (client) => findCrmDuplicates(client, context, input, input.excludeId),
    );
    return ok({ duplicates });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
