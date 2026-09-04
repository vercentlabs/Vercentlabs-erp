import {
  evaluateLeadDuplicateRisk,
  validateLeadInput,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { requireCrmManage } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
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

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "leads");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (c) => {
        const validation = await validateLeadInput(
          c,
          context,
          input,
          String(input.recordType || "standard"),
        );
        const duplicateEvaluation = await evaluateLeadDuplicateRisk(
          c,
          context,
          input,
          {
            excludeLeadId: String(input.id || "") || null,
            lock: false,
          },
        );
        const publicDuplicates = publicDuplicateResult(duplicateEvaluation);
        return {
          ...validation,
          duplicateClassification: publicDuplicates.classification,
          duplicates: publicDuplicates.matches,
          restrictedDuplicate: publicDuplicates.restrictedMatch,
          canOverrideDuplicate: publicDuplicates.canOverride,
        };
      },
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
