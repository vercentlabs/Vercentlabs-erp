import { evaluateLeadDuplicateRisk } from "@vercentlabs/api";
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
    const evaluation = await tenantTransaction(
      context.organizationId,
      (client) =>
        evaluateLeadDuplicateRisk(client, context, input, {
          excludeLeadId: input.excludeId || null,
          lock: false,
        }),
    );
    return ok({
      classification: evaluation.classification,
      matches: evaluation.matches,
      canOverride: evaluation.canOverride,
      // Compatibility alias for existing clients while F008 becomes canonical.
      duplicates: evaluation.matches,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
