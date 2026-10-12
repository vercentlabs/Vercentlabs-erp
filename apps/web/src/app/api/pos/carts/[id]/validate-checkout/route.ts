import { validatePosCartForCheckout } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// Is the bill ready for payment — discounts, limits, approvals, tax and totals checked again as of now — and if not, what to fix. Changes nothing.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => validatePosCartForCheckout(client, context, id), "pos.view");
}
