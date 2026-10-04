import { updateCustomerContact } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerWrite } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ id: string; contactId: string }> };

// body: jobTitle, department, role, addressId, notes, isPrimary,
// isBillingContact, isShippingContact, isProcurementContact, isActive,
// confirmOpenDocuments.
export async function PATCH(request: Request, { params }: Params) {
  const { id, contactId } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersManageContacts, async (client, context, body) => ({ contact: await updateCustomerContact(client, context, id, contactId, body) }));
}
