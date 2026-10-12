import { recoverDayEndFinalization } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ dayId: string }> };

// GET: whether the day was finalized and its Z report (what a lost answer would have said).
export async function GET(request: Request, { params }: Params) {
  const { dayId } = await params;
  return posRead(request, async (client, context) => ({ outcome: await recoverDayEndFinalization(client, context, dayId) }), "pos.view");
}
