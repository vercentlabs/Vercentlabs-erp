import { getPosCartLineDiscountEligibility } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string; lineId: string }> };

// Whether a line can take a manual discount, on what terms, and what is left of the cashier's limits.
export async function GET(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  return posRead(request, async (client, context) => ({ eligibility: await getPosCartLineDiscountEligibility(client, context, id, lineId) }), "pos.view");
}
