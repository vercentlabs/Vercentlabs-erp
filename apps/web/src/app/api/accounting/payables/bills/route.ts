import { createVendorBill, listVendorBills } from "@vercentlabs/api";

import { rethrowAccountingError } from "@/modules/accounting";
import { accountingSession } from "@/modules/accounting/server";
import { vendorBillSchema } from "@/modules/accounting/validation";
import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET(request: Request) {
  try {
    const { context } = await accountingSession();
    const url = new URL(request.url);
    const bills = await tenantTransaction(context.organizationId, (client) =>
      listVendorBills(client, context, {
        companyId: url.searchParams.get("companyId") || undefined,
        status: url.searchParams.get("status") || undefined,
        search: url.searchParams.get("search") || undefined,
        limit: url.searchParams.get("limit") || undefined,
        offset: url.searchParams.get("offset") || undefined,
      }),
    );
    return ok({ bills });
  } catch (error) {
    try {
      rethrowAccountingError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const input = vendorBillSchema.parse(await readJson(request));
    const bill = await tenantTransaction(context.organizationId, (client) =>
      createVendorBill(client, context, input),
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
