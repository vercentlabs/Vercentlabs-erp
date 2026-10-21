import { listPaymentAccounts } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The bank and cash accounts a payment can be received into, and the ways of paying (Sales audit B7).
export async function GET(request: Request) {
  return salesRead(request, "sales.invoice.view", async (client, context) => listPaymentAccounts(client, context));
}
