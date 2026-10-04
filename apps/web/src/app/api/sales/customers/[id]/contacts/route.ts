import { addCustomerContact, linkCustomerContact, listCustomerContacts } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type CustomerRouteParams, customerRead, customerWrite } from "@/features/sales/customers/server/customer-http";

// ?search= matches name, email, phone, role and department; ?addressId=
// lists the people at one location.
export async function GET(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  const url = new URL(request.url);
  return customerRead(request, SALES_PERMISSIONS.customerContactsView, async (client, context) => ({
    contacts: await listCustomerContacts(client, context, id, { search: url.searchParams.get("search") ?? "", addressId: url.searchParams.get("addressId") }),
  }));
}

// body with contactId links an existing contact; without it, a new contact
// is created, unless one like it already exists.
export async function POST(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersManageContacts, async (client, context, body) => ({
    contact: body.contactId ? await linkCustomerContact(client, context, id, body) : await addCustomerContact(client, context, id, body),
  }), 201);
}
