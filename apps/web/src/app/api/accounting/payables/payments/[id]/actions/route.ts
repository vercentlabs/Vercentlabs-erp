import { allocateVendorPayment, postVendorPayment, submitVendorPayment } from "@vercentlabs/api";
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
    let result: unknown;
    if (input.action === "submit") result = await tenantTransaction(context.organizationId, (client) => submitVendorPayment(client, context, id, input.assignedTo));
    else if (input.action === "post") result = await tenantTransaction(context.organizationId, (client) => postVendorPayment(client, context, id));
    else if (input.action === "allocate") result = await tenantTransaction(context.organizationId, (client) => allocateVendorPayment(client, context, id, input.input || {}));
    else throw new HttpError(400, "Unsupported payment action.");
    return ok({ result });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
