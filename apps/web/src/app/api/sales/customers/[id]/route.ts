import { deleteCustomer, getCustomer, updateCustomer } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type CustomerRouteParams, customerRead, customerWrite } from "@/features/sales/customers/server/customer-http";

export async function GET(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerRead(request, SALES_PERMISSIONS.customersView, async (client, context) => ({ customer: await getCustomer(client, context, id) }));
}

export async function PATCH(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersEdit, async (client, context, body) => ({ customer: await updateCustomer(client, context, id, body) }));
}

// Only a customer with no transactions can be deleted.
export async function DELETE(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersDelete, (client, context) => deleteCustomer(client, context, id));
}
