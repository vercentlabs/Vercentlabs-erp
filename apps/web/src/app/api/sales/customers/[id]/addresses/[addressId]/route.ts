import { setCustomerAddressActive, setDefaultBillingAddress, setDefaultShippingAddress, updateCustomerAddress } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerWrite } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ id: string; addressId: string }> };

// body: the address fields to change, or { action: default_billing |
// default_shipping | deactivate | reactivate }. Each operation checks the
// permission for what it does.
export async function PATCH(request: Request, { params }: Params) {
  const { id, addressId } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customerAddressesView, async (client, context, body) => {
    if (body.action === "default_billing") return { address: await setDefaultBillingAddress(client, context, id, addressId) };
    if (body.action === "default_shipping") return { address: await setDefaultShippingAddress(client, context, id, addressId) };
    if (body.action === "deactivate" || body.action === "reactivate") return { address: await setCustomerAddressActive(client, context, id, addressId, body.action === "reactivate") };
    return { address: await updateCustomerAddress(client, context, id, addressId, body) };
  });
}
