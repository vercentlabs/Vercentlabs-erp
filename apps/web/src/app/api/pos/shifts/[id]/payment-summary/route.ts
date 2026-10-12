import { getShiftPaymentSummary } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: sales, card / UPI / cash and split totals and refunds of the shift (payment confirmation, not bank settlement).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ summary: await getShiftPaymentSummary(client, context, id) }), "pos.view");
}
