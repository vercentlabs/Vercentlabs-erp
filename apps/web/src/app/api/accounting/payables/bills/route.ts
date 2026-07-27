import { createVendorBill, listVendorBills } from "@vercentlabs/api";

import { rethrowAccountingError } from "@/lib/accounting";
import { accountingSession } from "@/lib/accounting-route";
import { vendorBillSchema } from "@/lib/accounting-validation";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

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
