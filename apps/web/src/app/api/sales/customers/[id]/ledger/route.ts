import { getCustomerLedger } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type CustomerRouteParams, customerRead } from "@/features/sales/customers/server/customer-http";

// The customer's ledger (Sales audit M7): ?from=&to= (the financial year so far by default).
export async function GET(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  const url = new URL(request.url);
  return customerRead(request, SALES_PERMISSIONS.customersView, async (client, context) => ({
    ledger: await getCustomerLedger(client, context, id, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }),
  }));
}
