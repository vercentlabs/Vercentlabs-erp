import { applyCustomerCreditNote, postCustomerInvoice, submitCustomerInvoice } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { accountingActionSchema } from "@/lib/accounting-validation";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const { id } = await route.params;
    const input = accountingActionSchema.parse(await readJson(request));
    if (input.action === "submit") {
      const result = await tenantTransaction(context.organizationId, (client) => submitCustomerInvoice(client, context, id, input.assignedTo));
      return ok({ result });
    }
    if (input.action === "post") {
      const result = await tenantTransaction(context.organizationId, (client) => postCustomerInvoice(client, context, id));
      return ok({ result });
    }
    if (input.action === "apply_credit") {
      const result = await tenantTransaction(context.organizationId, (client) => applyCustomerCreditNote(client, context, id, input.input || {}));
      return ok({ result });
    }
    throw new HttpError(400, "Unsupported invoice action.");
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
