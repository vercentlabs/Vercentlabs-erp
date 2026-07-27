import { createInvoiceFromSalesRequest } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, HttpError, ok } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const { id } = await route.params;
    const invoice = await tenantTransaction(context.organizationId, (client) =>
      createInvoiceFromSalesRequest(client, context, id),
    );
    if ("accountingImportFailed" in invoice && invoice.accountingImportFailed === true) {
      throw new HttpError(409, String(invoice.message || "The Sales invoice request could not be imported."));
    }
    return ok({ invoice }, 201);
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
