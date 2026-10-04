import { searchLinkableCustomerContacts } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type CustomerRouteParams, customerRead } from "@/features/sales/customers/server/customer-http";

// CRM contacts that could be linked to this customer.
export async function GET(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  const search = new URL(request.url).searchParams.get("search") ?? "";
  return customerRead(request, SALES_PERMISSIONS.customersManageContacts, async (client, context) => ({ contacts: await searchLinkableCustomerContacts(client, context, id, search) }));
}
