import { findDuplicateCustomers } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerWrite } from "@/features/sales/customers/server/customer-http";

// Checks a customer being typed in against the existing ones. POST because
// the probe is a body, not because anything is saved.
export async function POST(request: Request) {
  return customerWrite(request, SALES_PERMISSIONS.customersView, (client, context, body) =>
    findDuplicateCustomers(client, context, body, { excludeId: typeof body.excludeId === "string" ? body.excludeId : null }));
}
