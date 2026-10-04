import { linkCustomerToAccount } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { type CustomerRouteParams, customerWrite } from "@/features/sales/customers/server/customer-http";

// Links a CRM account to this customer: the account is merged into it.
export async function POST(request: Request, { params }: CustomerRouteParams) {
  const { id } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersLinkAccount, async (client, context, body) => {
    if (typeof body.accountId !== "string") throw new HttpError(400, "Choose the CRM account to link.");
    return { customer: await linkCustomerToAccount(client, context, id, body.accountId) };
  });
}
