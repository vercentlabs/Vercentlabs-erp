import { activateBudget, submitBudget } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { budgetActionSchema } from "@/modules/accounting/validation";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const { id } = await route.params;
    const input = budgetActionSchema.parse(await readJson(request));
    const result = await tenantTransaction(context.organizationId, (client) => {
      if (input.action === "submit") return submitBudget(client, context, id, input.assignedTo);
      if (input.action === "activate") return activateBudget(client, context, id);
      throw new HttpError(400, "Unsupported budget action.");
    });
    return ok({ result });
  } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
