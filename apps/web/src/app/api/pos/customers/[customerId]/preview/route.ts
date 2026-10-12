import { getPosCustomerPreview } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ customerId: string }> };

// What the cashier needs to confirm the right customer (CUSTOMER_SELECT): identity, type, GST, price list, billing addresses, eligibility.
export async function GET(request: Request, { params }: Params) {
  const { customerId } = await params;
  const cartId = new URL(request.url).searchParams.get("cartId");
  return posRead(request, async (client, context) => ({ customer: await getPosCustomerPreview(client, context, customerId, { cartId }) }), "pos.view");
}
