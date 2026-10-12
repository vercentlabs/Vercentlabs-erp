import { getShiftBlockingTransactions } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: what is unfinished on the shift — what blocks an ordinary close, what a supervisor handed to an owner, held bills.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ blockers: await getShiftBlockingTransactions(client, context, id) }), "pos.view");
}
