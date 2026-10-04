import { findExistingContact } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type CustomerRouteParams, customerWrite } from "@/features/sales/customers/server/customer-http";

// Looks for an existing contact with the same email, mobile or name before a
// new one is created. POST because the probe is a body; nothing is saved.
export async function POST(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersManageContacts, (client, context, body) => findExistingContact(client, context, id, body));
}
