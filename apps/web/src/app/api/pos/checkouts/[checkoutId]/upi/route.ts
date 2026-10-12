import { getPosCheckoutUpiOptions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// What this checkout can do with UPI: dynamic QR, payment link, UPI intent (only where the provider offers it), the shop's verified static
// QR, the merchant name customers see, the amount due and any request still open (so a refreshed screen continues it).
export async function GET(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posRead(request, async (client, context) => ({ upi: await getPosCheckoutUpiOptions(client, context, checkoutId) }), "pos.view");
}
