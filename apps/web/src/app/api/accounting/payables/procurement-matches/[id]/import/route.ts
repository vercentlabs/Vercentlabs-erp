import { importProcurementMatchAsVendorBill } from "@vercentlabs/api";

import { rethrowAccountingError } from "@/modules/accounting";
import { accountingSession } from "@/modules/accounting/server";
import { procurementVendorBillImportSchema } from "@/modules/accounting/validation";
import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

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
