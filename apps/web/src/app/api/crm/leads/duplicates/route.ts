import { findCrmDuplicates } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { duplicateSchema } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const url = new URL(request.url);
    const input = duplicateSchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    const context = await crmApiContext(session);
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
