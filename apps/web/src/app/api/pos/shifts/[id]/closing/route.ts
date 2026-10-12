import { recoverShiftClosing } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// GET: whether the shift closed and its closing (what a lost close response would have said).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ result: await recoverShiftClosing(client, context, id) }), "pos.view");
}
