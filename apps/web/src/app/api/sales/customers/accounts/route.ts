import { searchAccountsForCustomer } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerRead } from "@/features/sales/customers/server/customer-http";

// CRM accounts that are not customers yet.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get("search") ?? "";
  return customerRead(request, SALES_PERMISSIONS.customersLinkAccount, async (client, context) => ({ accounts: await searchAccountsForCustomer(client, context, search) }));
}
