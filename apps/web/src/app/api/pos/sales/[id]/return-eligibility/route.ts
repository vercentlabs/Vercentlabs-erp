import { getPosSaleReturnEligibility } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET ?storeId=: what can still be returned from this sale — sold, returned, held by open returns, the original price and tax per unit,
// tracking, restrictions, the return window and the original tenders.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const storeId = new URL(request.url).searchParams.get("storeId") ?? undefined;
  return posRead(request, async (client, context) => ({ eligibility: await getPosSaleReturnEligibility(client, context, id, { storeId }) }), "pos.view");
}
