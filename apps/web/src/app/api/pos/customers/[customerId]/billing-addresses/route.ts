import { getPosCustomerPreview } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ customerId: string }> };

// The customer's active billing addresses, the default first (CUSTOMER_SELECT) — the ones a bill may be invoiced to.
export async function GET(request: Request, { params }: Params) {
  const { customerId } = await params;
  const cartId = new URL(request.url).searchParams.get("cartId");
  return posRead(request, async (client, context) => ({ addresses: (await getPosCustomerPreview(client, context, customerId, { cartId })).billingAddresses }), "pos.view");
}
