import { addConsolidationAdjustment, finalizeConsolidationRun } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { consolidationActionSchema } from "@/lib/accounting-validation";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const { id } = await route.params;
    const input = consolidationActionSchema.parse(await readJson(request));
    const result = await tenantTransaction(context.organizationId, (client) => {
      if (input.action === "finalize") return finalizeConsolidationRun(client, context, id);
      if (input.action === "adjust") return addConsolidationAdjustment(client, context, id, input);
      throw new HttpError(400, "Unsupported consolidation action.");
    });
    return ok({ result });
  } catch (error) { try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); } }
}
