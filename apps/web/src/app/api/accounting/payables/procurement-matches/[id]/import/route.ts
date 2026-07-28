import { importProcurementMatchAsVendorBill } from "@vercentlabs/api";

import { rethrowAccountingError } from "@/lib/accounting";
import { accountingSession } from "@/lib/accounting-route";
import { procurementVendorBillImportSchema } from "@/lib/accounting-validation";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { context: accountingContext } = await accountingSession(true);
    const { id } = await context.params;
    const input = procurementVendorBillImportSchema.parse(await readJson(request));
    const bill = await tenantTransaction(accountingContext.organizationId, (client) =>
      importProcurementMatchAsVendorBill(client, accountingContext, id, input),
    );
    return ok({ bill }, 201);
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
