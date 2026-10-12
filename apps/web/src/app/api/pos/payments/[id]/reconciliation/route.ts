import { getPaymentReconciliationStatus } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: a payment's reconciliation status in plain words (for the counter).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ status: await getPaymentReconciliationStatus(client, context, id) }), "pos.view");
}
