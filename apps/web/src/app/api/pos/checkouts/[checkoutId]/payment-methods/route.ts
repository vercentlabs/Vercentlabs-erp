import { getPosCheckoutPaymentMethods } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// The methods this checkout can take (the bill id is the checkout id), the amount due, and the cash options: quick amounts, limits, drawer.
export async function GET(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posRead(request, async (client, context) => ({ paymentMethods: await getPosCheckoutPaymentMethods(client, context, checkoutId) }), "pos.view");
}
