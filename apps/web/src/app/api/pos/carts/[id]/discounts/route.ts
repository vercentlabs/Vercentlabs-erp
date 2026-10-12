import { getPosCartDiscountEligibility, listPosCartDiscounts } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Every discount on the bill, line by line (promotion, item discount, the share of the bill discount, any problem), and the bill discount
// itself: the current one, what is eligible and what is left out (and why), the reasons, the cashier's limits and the history.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({
    discounts: await listPosCartDiscounts(client, context, id),
    cart: await getPosCartDiscountEligibility(client, context, id),
  }), "pos.view");
}
