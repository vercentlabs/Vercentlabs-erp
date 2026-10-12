import { getPosRefundEligibility } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: what the return still owes the customer — its authorized refund, what other refunds hold or paid, and each original tender's
// remaining refundable amount and route (cash, provider, or refunded outside the provider).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ eligibility: await getPosRefundEligibility(client, context, "pos_return", id) }), "pos.view");
}
