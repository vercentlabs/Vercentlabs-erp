import {
  evaluateLeadDuplicateRisk,
  validateLeadInput,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmManage } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
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
        return {
          ...validation,
          duplicateClassification: duplicateEvaluation.classification,
          duplicates: duplicateEvaluation.matches,
          canOverrideDuplicate: duplicateEvaluation.canOverride,
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
