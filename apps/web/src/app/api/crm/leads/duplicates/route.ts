import { evaluateLeadDuplicateRisk } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { requireCrmView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { duplicateSchema } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

function publicDuplicateResult(evaluation: { classification: string; matches: Array<Record<string, unknown>>; canOverride: boolean }) {
  const matches = evaluation.matches.filter((match) => match.restricted !== true);
  const classification = matches.some((match) => match.classification === "exact")
    ? "exact"
    : matches.length
      ? "probable"
      : evaluation.matches.some((match) => match.restricted === true)
        ? "restricted"
        : "none";
  return {
    classification,
    matches,
    restrictedMatch: evaluation.matches.some((match) => match.restricted === true),
    canOverride: evaluation.canOverride,
  };
}

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
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
    const publicResult = publicDuplicateResult(evaluation);
    return ok({
      ...publicResult,
      // Compatibility alias for existing clients while F008 becomes canonical.
      duplicates: publicResult.matches,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
