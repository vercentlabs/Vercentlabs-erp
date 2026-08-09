import { validateLeadInput, findLeadDuplicates } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requireCrmManage } from "@/lib/crm-api";
import { crmApiContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
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
        const duplicates = await findLeadDuplicates(
          c,
          context,
          input,
          String(input.id || "") || null,
        );
        return { ...validation, duplicates };
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
