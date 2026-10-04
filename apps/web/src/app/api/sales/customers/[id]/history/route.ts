import { listCustomerHistory } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { type CustomerRouteParams, customerRead } from "@/features/sales/customers/server/customer-http";

export async function GET(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerRead(request, SALES_PERMISSIONS.customersView, async (client, context) => ({ history: await listCustomerHistory(client, context, id) }));
}
