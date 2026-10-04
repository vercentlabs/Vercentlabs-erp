import { createCustomer, listCustomers } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerFiltersFromUrl, customerRead, customerWrite } from "@/features/sales/customers/server/customer-http";

// The customer list for a view, a search and filters.
export async function GET(request: Request) {
  return customerRead(request, SALES_PERMISSIONS.customersView, (client, context) => listCustomers(client, context, customerFiltersFromUrl(new URL(request.url))));
}

// Creates a customer, with its first addresses and primary contact.
export async function POST(request: Request) {
  return customerWrite(request, SALES_PERMISSIONS.customersCreate, async (client, context, body) => ({ customer: await createCustomer(client, context, body) }), 201);
}
