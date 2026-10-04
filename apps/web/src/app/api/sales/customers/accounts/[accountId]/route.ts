import { createCustomerFromAccount, getCustomerPrefillFromAccount } from "@vercentlabs/api/sales/customers";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { customerRead, customerWrite } from "@/features/sales/customers/server/customer-http";

type Params = { params: Promise<{ accountId: string }> };

// What the customer form starts with for this CRM account.
export async function GET(request: Request, { params }: Params) {
  const { accountId } = await params;
  return customerRead(request, SALES_PERMISSIONS.customersLinkAccount, (client, context) => getCustomerPrefillFromAccount(client, context, accountId));
}

// The account becomes the customer.
export async function POST(request: Request, { params }: Params) {
  const { accountId } = await params;
  return customerWrite(request, SALES_PERMISSIONS.customersLinkAccount, async (client, context, body) => ({ customer: await createCustomerFromAccount(client, context, accountId, body) }), 201);
}
