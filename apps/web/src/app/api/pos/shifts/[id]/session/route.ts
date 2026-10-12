import { getPosShiftSession } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: the shift as its counter shows it — status, cash mode and float, handover, pause and review.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ shift: await getPosShiftSession(client, context, id) }), "pos.view");
}
