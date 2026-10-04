import { searchCustomers } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerRead } from "@/features/sales/customers/server/customer-http";

// A short list for customer pickers.
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get("search") ?? "";
  return customerRead(request, SALES_PERMISSIONS.customersView, async (client, context) => ({ customers: await searchCustomers(client, context, search) }));
}
