import { getShiftCashReconciliation } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: expected against counted cash — after the blind count, for the counter (when the policy shows it) and those who may see expected cash.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ reconciliation: await getShiftCashReconciliation(client, context, id) }), "pos.view");
}
