import { activateBudget, submitBudget } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { budgetActionSchema } from "@/lib/accounting-validation";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

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
