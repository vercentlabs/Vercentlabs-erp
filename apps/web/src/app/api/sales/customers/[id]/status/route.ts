import { activateCustomer, blockCustomer, deactivateCustomer, unblockCustomer } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { type CustomerRouteParams, customerWrite } from "@/features/sales/customers/server/customer-http";

const ACTIONS = { activate: activateCustomer, deactivate: deactivateCustomer, block: blockCustomer, unblock: unblockCustomer } as const;

// body: { action: activate | deactivate | block | unblock, reason? }. The
// operation checks the permission for its own action.
export async function POST(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersView, async (client, context, body) => {
    const action = ACTIONS[String(body.action) as keyof typeof ACTIONS];
    if (!action) throw new HttpError(400, "Unknown status action.");
    return { customer: await action(client, context, id, { reason: body.reason }) };
  });
}
