import { listCustomerRelated } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerRead } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ id: string; list: string }> };

// The rows behind a tab: quotations, orders, deliveries, invoices, payments,
// returns, projects or support.
export async function GET(request: Request, { params }: Params) {
  const { id, list } = await params;
  return customerRead(request, SALES_PERMISSIONS.customersView, async (client, context) => ({ rows: await listCustomerRelated(client, context, id, list) }));
}
