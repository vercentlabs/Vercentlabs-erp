import { addCustomerAddress, listCustomerAddresses } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type CustomerRouteParams, customerRead, customerWrite } from "@/features/sales/customers/server/customer-http";

// ?search= matches the label, city, state and postal code.
export async function GET(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  const search = new URL(request.url).searchParams.get("search") ?? "";
  return customerRead(request, SALES_PERMISSIONS.customerAddressesView, async (client, context) => ({ addresses: await listCustomerAddresses(client, context, id, { search }) }));
}

// body: the address, and allowDuplicate to save one the customer already has.
export async function POST(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersManageAddresses, async (client, context, body) => ({ address: await addCustomerAddress(client, context, id, body) }), 201);
}
