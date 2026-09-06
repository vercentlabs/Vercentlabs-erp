import { dismissLeadDuplicateMatch, evaluateLeadDuplicateRisk } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { requireCrmView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { duplicateSchema } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

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

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const input = (await readJson(request)) as Record<string, unknown>;
    const leadId = String(input.leadId || "");
    const matchedLeadId = String(input.matchedLeadId || "");
    const reason = String(input.reason || "");
    const context = await crmApiContext(session);
    const dismissal = await tenantTransaction(context.organizationId, async (client) => {
      const record = await dismissLeadDuplicateMatch(client, context, leadId, matchedLeadId, reason);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.duplicate_dismissed",
        entityType: "lead",
        entityId: leadId,
        afterData: { matchedLeadId, reason },
        request,
        client,
      });
      return record;
    });
    return ok({ message: "Duplicate signal dismissed.", dismissal });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
