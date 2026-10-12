import { getPosCustomerPurchaseHistory } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ customerId: string }> };

// A customer's finished POS purchases at the caller's outlets (CUSTOMER_SELECT and TRANSACTION_LOOKUP), newest first. Read-only.
export async function GET(request: Request, { params }: Params) {
  const { customerId } = await params;
  const url = new URL(request.url);
  return posRead(request, async (client, context) => getPosCustomerPurchaseHistory(client, context, customerId, {
    cartId: url.searchParams.get("cartId"),
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
  }), "pos.view");
}
