import { getCustomerOutstanding } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerRead } from "@/features/sales/customers/server/customer-http";

// What each customer owes, by age (Sales audit M7): ?asOf=&search=
export async function GET(request: Request) {
  const url = new URL(request.url);
  return customerRead(request, SALES_PERMISSIONS.customersView, async (client, context) => ({
    outstanding: await getCustomerOutstanding(client, context, { asOf: url.searchParams.get("asOf") ?? undefined, search: url.searchParams.get("search") ?? undefined }),
  }));
}
